import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { TestRecord } from '../models/TestRecord';
import { DrugResult, SUBSTANCES, CONTROL_LINE_KEY } from '../models/DrugResult';
import { ResultValue } from '../models/ResultValue';
import { hasSecondTest } from '../models/AlcoholTestInfo';
import { donorFullName } from '../models/TestRecord';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { pdfFilePath, sanitizeFileName } from './fileStorage';
import { LOGO_BASE64_PNG } from './logoBase64';

/**
 * Builds a multi-page PDF report for a completed donor test record — a redesign of
 * PdfReportGenerator.java, not a line-for-line port: the native version hand-draws every page via
 * Android's PdfDocument/Canvas API, which has no RN equivalent. This renders an HTML+CSS document
 * with the same section order, labels, and layout instead, and hands it to expo-print
 * (Print.printToFileAsync) to rasterize into a PDF — same content and structure, different
 * rendering pipeline. Photos/signatures are inlined as base64 data URIs since the PDF renderer
 * can't reliably reach arbitrary local file:// paths.
 */

const COLORS = {
  brandPrimary: '#0B4F6C',
  brandAccent: '#01A7C2',
  brandSuccess: '#2E7D32',
  brandDanger: '#C62828',
  textPrimary: '#1A2226',
  textSecondary: '#5B6B73',
  divider: '#DCE3E6',
};

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function nullToDash(s: string | null | undefined): string {
  return !s || s.trim() === '' ? '-' : s;
}

/** Signatures are already small (drawn on a ~180pt-tall canvas) — read straight through as PNG,
 *  which their transparency needs. */
async function toSignatureDataUri(localPath: string | null | undefined): Promise<string | null> {
  if (!localPath) return null;
  try {
    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(localPath, { encoding: FileSystem.EncodingType.Base64 });
    return `data:image/png;base64,${base64}`;
  } catch {
    return null;
  }
}

const PHOTO_MAX_WIDTH = 1000;
// Used only for the emailed copy — mirrors PdfReportGenerator.java's forEmail()/EMAIL_IMAGE_SCALE
// (0.55, roughly a third the pixel area of the default). The emailed PDF travels as a base64
// payload straight in a Cloud Function callable's request body rather than through Storage, so its
// size directly affects how likely that call is to hit a cold-start timeout — this app's default
// (undiminished) PDF was still using PHOTO_MAX_WIDTH's full resolution for email, unlike native,
// which is the likely reason an email send can fail with an "internal" error on a cold function
// and then succeed immediately on retry once the container's warm.
const PHOTO_MAX_WIDTH_EMAIL = 550;

/** Photos come straight off the phone's camera at full sensor resolution — often several MB
 *  each. Embedding that unresized as base64 in the PDF's HTML was the actual cause of Save being
 *  slow: a WebView has to parse and rasterize several multi-MB base64 strings. Native's own PDF
 *  generator deliberately decodes photos bounded to their on-page display size before drawing
 *  them (see BitmapUtils.loadPhotoForDisplay) — this does the equivalent here: resize to a sane
 *  max width and re-encode as JPEG before the photo ever becomes a base64 string, which is both
 *  much faster to produce and far smaller for expo-print's WebView to render. */
async function toPhotoDataUri(localPath: string | null | undefined, emailMode = false): Promise<string | null> {
  if (!localPath) return null;
  try {
    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists) return null;
    const maxWidth = emailMode ? PHOTO_MAX_WIDTH_EMAIL : PHOTO_MAX_WIDTH;
    const result = await ImageManipulator.manipulateAsync(localPath, [{ resize: { width: maxWidth } }], {
      compress: emailMode ? 0.6 : 0.75,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    return result.base64 ? `data:image/jpeg;base64,${result.base64}` : null;
  } catch {
    return null;
  }
}

function sectionTitle(title: string): string {
  return `<div class="section-title">${esc(title)}</div>`;
}

function subheading(text: string): string {
  return `<div class="subheading">${esc(text)}</div>`;
}

function labelValue(label: string, value: string): string {
  return `<div class="row"><span class="label">${esc(label)}:</span><span class="value">${esc(value)}</span></div>`;
}

function resultLine(label: string, result: string | null, negativeText = 'Negative', nonNegativeText = 'Non-Negative'): string {
  const negative = result === ResultValue.NEGATIVE;
  const nonNegative = result === ResultValue.NON_NEGATIVE;
  const cls = negative ? 'result-negative' : nonNegative ? 'result-nonnegative' : 'value';
  const text = result == null ? '-' : negative ? negativeText : nonNegative ? nonNegativeText : result;
  return `<div class="row"><span class="label">${esc(label)}:</span><span class="${cls}">${esc(text)}</span></div>`;
}

function checkboxItem(text: string, checked: boolean): string {
  if (!text) return '';
  return `<div class="checkbox-item">
    <span class="checkbox ${checked ? 'checkbox-checked' : ''}">${checked ? '✓' : ''}</span>
    <span class="checkbox-text">${esc(text)}</span>
  </div>`;
}

function signatureBlock(label: string, dataUri: string | null): string {
  return `<div class="sig-block">
    <div class="block-label">${esc(label)}:</div>
    <div class="sig-box">${dataUri ? `<img src="${dataUri}" class="sig-img" />` : ''}</div>
  </div>`;
}

function photoBlock(dataUri: string | null, label?: string): string {
  const labelHtml = label ? `<div class="block-label">${esc(label)}:</div>` : '';
  if (!dataUri) {
    return `${labelHtml}<div class="photo-missing">(no photo)</div>`;
  }
  return `${labelHtml}<div class="photo-box"><img src="${dataUri}" class="photo-img" /></div>`;
}

async function buildHtml(record: TestRecord, emailMode = false): Promise<string> {
  // Every photo/signature is resolved to a data URI concurrently up front, rather than one at a
  // time as each section is built — these are independent file reads (and, for photos, an image
  // resize), so awaiting them in sequence was pure wasted wall-clock time.
  const [
    donorIdPhotoUri,
    donorSignatureUri,
    operatorSignatureUri,
    drugTestPhotoUri,
    drugConfirmationSignatureUri,
    alcoholPhoto1Uri,
    alcoholPhoto2Uri,
    finalSignOffSignatureUri,
  ] = await Promise.all([
    toPhotoDataUri(record.donor.idPhotoPath, emailMode),
    toSignatureDataUri(record.donor.signaturePath),
    toSignatureDataUri(record.operatorConsent.signaturePath),
    toPhotoDataUri(record.drugTestPhotoPath, emailMode),
    toSignatureDataUri(record.drugResult.confirmationSignaturePath),
    toPhotoDataUri(record.alcoholTestPhotoPath, emailMode),
    toPhotoDataUri(record.alcoholTestPhotoPath2, emailMode),
    toSignatureDataUri(record.finalSignOff.signaturePath),
  ]);

  const parts: string[] = [];

  // ---- Header ----
  parts.push(`
    <div class="header">
      <div class="header-top">
        <img src="data:image/png;base64,${LOGO_BASE64_PNG}" class="header-logo" />
        <div>
          <div class="header-title">TrustCheck</div>
          <div class="header-sub">Donor Test Workflow Report</div>
        </div>
      </div>
      <div class="header-meta">
        <span>Record ID: ${esc(record.id)}</span>
        <span>Generated: ${esc(formatDateTime(Date.now()))}</span>
      </div>
    </div>
  `);

  // ---- Donor Information ----
  parts.push(sectionTitle('Donor Information'));
  parts.push(
    checkboxItem(
      "The drug and alcohol test procedure will be carried out by a qualified person and has been explained to me and I consent to collection and on-site initial screen which will be conducted in accordance with relevant international standards, workplace policy and NZ Law. I understand the consequences of a not negative onsite result. When required my specimen(s) will be processed in my presence to transport to an accredited Laboratory for Drug and/or Alcohol testing.",
      record.donor.initialConsentAgreed
    )
  );
  parts.push(labelValue('Test #', nullToDash(record.donor.testNumber)));
  parts.push(labelValue('Donor ID', nullToDash(record.donor.donorId)));
  parts.push(labelValue('Name', nullToDash(record.donor.firstName)));
  parts.push(labelValue('Surname', nullToDash(record.donor.surname)));
  parts.push(labelValue('Date of Birth', formatDate(record.donor.dateOfBirth)));
  parts.push(photoBlock(donorIdPhotoUri, 'Photo of Donor ID'));
  parts.push(
    labelValue(
      'Medication in last 7 days',
      record.donor.medicationLast7Days == null ? '-' : record.donor.medicationLast7Days ? 'Yes' : 'No'
    )
  );
  if (record.donor.medicationLast7Days === true) {
    parts.push(labelValue('Medication details', nullToDash(record.donor.medicationDetails)));
  }
  parts.push(subheading('Declaration'));
  const declarations = [
    'I declare that the specimen provided by me to the authorised Collector for the purpose of this Drug and or alcohol test is my own.',
    'I declare that any on-site Drug and/or alcohol screen test performed was carried out in my presence.',
    'I declare that the information provided on this form is correct and I consent to the release of all test results together with relevant details on this form to the nominated authority indicated above.',
    'I declare that if required ,I further consent to, appropriate specimen(s) collected and/or processed in my presence that will be transported to an accredited Laboratory for the purpose of drug confirmation in compliance with relevant NZ Standards.',
  ];
  for (const d of declarations) parts.push(checkboxItem(d, record.donor.declarationAgreed));
  parts.push(signatureBlock('Donor signature', donorSignatureUri));

  // ---- Test Setup ----
  parts.push(sectionTitle('Test Setup'));
  parts.push(labelValue('Company', nullToDash(record.testSetup.company)));
  parts.push(labelValue('Testing site', nullToDash(record.testSetup.testingSite)));
  parts.push(labelValue('Reason for test', nullToDash(record.testSetup.reasonForTest)));
  parts.push(labelValue('Supervisor on site', nullToDash(record.testSetup.supervisorOnSite)));
  parts.push(labelValue('Support person', nullToDash(record.testSetup.supportPerson)));
  parts.push(labelValue('Result recipient', nullToDash(record.testSetup.resultRecipient)));

  // ---- Operator Consent ----
  parts.push(sectionTitle('Operator Consent'));
  parts.push(labelValue('Operator name', nullToDash(record.operatorConsent.operatorName)));
  parts.push(labelValue('Operator ID', nullToDash(record.operatorConsent.operatorId)));
  parts.push(
    labelValue(
      'NZQA qualified',
      record.operatorConsent.qualificationAvailable == null ? '-' : record.operatorConsent.qualificationAvailable ? 'Yes' : 'No'
    )
  );
  parts.push(subheading('Collector Declaration'));
  parts.push(
    checkboxItem(
      'I declare that I witnessed the Test Subject/Employee signature and the specimen identified with this form was provided to me by the Test Subject/Employee whose informed consent was obtained and whose declaration appears above and for whom I obtained identity verification. Furthermore I declare the specimen collection, and on-site drug or alcohol screening was performed in accordance with relevant Standards or procedures detailed in the Workplace Health and Safety Manual/Policy of the requesting company.',
      record.operatorConsent.agreedNoDataMisuse
    )
  );
  parts.push(signatureBlock('Operator signature', operatorSignatureUri));

  // ---- Test Kit Information ----
  parts.push(sectionTitle('Test Kit Information'));
  parts.push(labelValue('Part No.', nullToDash(record.testKitInfo.partNo)));
  parts.push(labelValue('LOT No.', nullToDash(record.testKitInfo.lotNo)));
  parts.push(labelValue('Expiry date', formatDate(record.testKitInfo.expiryDate, record.testKitInfo.expiryDayKnown)));

  // ---- Drug Test Photo / Result ----
  parts.push(sectionTitle('Drug Test Photo'));
  parts.push(photoBlock(drugTestPhotoUri));

  parts.push(sectionTitle('Drug Test Result'));
  parts.push(resultLine('Overall result', record.drugResult.overallResult));
  if (record.drugResult.overallResult === ResultValue.NON_NEGATIVE) {
    for (const substance of SUBSTANCES) {
      if (substance === CONTROL_LINE_KEY) continue;
      parts.push(resultLine(substance, record.drugResult.substanceResults[substance] ?? null));
    }
  }
  parts.push(signatureBlock('Operator confirmation signature', drugConfirmationSignatureUri));

  // ---- Alcohol Test Information ----
  parts.push(sectionTitle('Alcohol Test Information'));
  parts.push(labelValue('Device serial #', nullToDash(record.alcoholTestInfo.deviceSerial)));
  parts.push(labelValue('Calibration expiry', formatDate(record.alcoholTestInfo.calibrationExpiry)));
  parts.push(labelValue('Measurement unit', nullToDash(record.alcoholTestInfo.measurementUnit)));
  parts.push(labelValue('First test date & time', formatDateTime(record.alcoholTestInfo.firstTestDateTime)));
  parts.push(
    labelValue(
      '15 min waiting time',
      record.alcoholTestInfo.waiting15Min == null ? '-' : record.alcoholTestInfo.waiting15Min ? 'Yes' : 'No'
    )
  );
  const secondTest = hasSecondTest(record.alcoholTestInfo);
  if (secondTest) {
    parts.push(labelValue('Second test date & time', formatDateTime(record.alcoholTestInfo.secondTestDateTime)));
  }

  parts.push(sectionTitle('Alcohol Test Photo'));
  if (secondTest) {
    parts.push(photoBlock(alcoholPhoto1Uri, 'First test photo'));
    parts.push(photoBlock(alcoholPhoto2Uri, 'Second test photo'));
  } else {
    parts.push(photoBlock(alcoholPhoto1Uri));
  }

  parts.push(sectionTitle('Alcohol Test Result'));
  parts.push(resultLine('First test result', record.alcoholResult.firstTestResult, 'Pass', 'Fail'));
  if (secondTest) {
    parts.push(resultLine('Second test result', record.alcoholResult.secondTestResult, 'Pass', 'Fail'));
  }

  // ---- Final Sign-off ----
  parts.push(sectionTitle('Final Sign-off'));
  parts.push(labelValue('Operator name', nullToDash(record.finalSignOff.operatorName)));
  parts.push(signatureBlock('Operator signature', finalSignOffSignatureUri));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 40px; }
  body { font-family: Helvetica, Arial, sans-serif; color: ${COLORS.textPrimary}; font-size: 12px; }
  .header { border-bottom: 1px solid ${COLORS.divider}; padding-bottom: 12px; margin-bottom: 12px; }
  .header-top { display: flex; align-items: center; }
  .header-logo { width: 44px; height: 44px; margin-right: 12px; }
  .header-title { color: ${COLORS.brandPrimary}; font-size: 20px; font-weight: bold; }
  .header-sub { color: ${COLORS.textSecondary}; font-size: 11px; margin-top: 2px; }
  .header-meta { display: flex; justify-content: space-between; color: ${COLORS.textSecondary}; font-size: 9px; margin-top: 10px; }
  .section-title { color: ${COLORS.brandPrimary}; font-size: 14px; font-weight: bold; margin-top: 18px; padding-bottom: 4px; border-bottom: 1.5px solid ${COLORS.brandAccent}; display: inline-block; }
  .subheading { font-size: 11.5px; font-weight: bold; margin-top: 10px; margin-bottom: 4px; }
  .row { margin-top: 6px; }
  .label { color: ${COLORS.textSecondary}; font-size: 11px; display: inline-block; width: 160px; }
  .block-label { color: ${COLORS.textSecondary}; font-size: 11px; display: block; margin-top: 4px; }
  .value { font-size: 12px; }
  .result-negative { font-size: 12px; font-weight: bold; color: ${COLORS.brandSuccess}; }
  .result-nonnegative { font-size: 12px; font-weight: bold; color: ${COLORS.brandDanger}; }
  .checkbox-item { display: flex; align-items: flex-start; margin-top: 8px; }
  .checkbox { width: 12px; height: 12px; border: 1.2px solid ${COLORS.textSecondary}; margin-right: 8px; flex-shrink: 0; text-align: center; font-size: 10px; line-height: 11px; color: ${COLORS.brandAccent}; }
  .checkbox-checked { border-color: ${COLORS.brandAccent}; }
  .checkbox-text { font-size: 11px; line-height: 1.4; }
  .sig-block { margin-top: 10px; }
  .sig-box { width: 200px; height: 70px; border: 1px solid ${COLORS.divider}; margin-top: 4px; display: flex; align-items: center; justify-content: center; }
  .sig-img { max-width: 190px; max-height: 60px; }
  .photo-box { width: 100%; max-width: 515px; margin-top: 4px; }
  .photo-img { max-width: 100%; max-height: 260px; }
  .photo-missing { color: ${COLORS.textSecondary}; font-size: 10px; margin-top: 4px; }
</style>
</head>
<body>
${parts.join('\n')}
</body>
</html>`;
}

/** Default suggestion shown on the Report screen's editable file-name field before the operator
 *  changes it — donor name + test # + date, in that order, whichever parts exist. Mirrors
 *  PdfReportGenerator.java#suggestFileName. */
export function suggestFileName(record: TestRecord): string {
  let name = donorFullName(record).replace('(Unnamed donor)', 'Report');
  if (record.donor.testNumber && record.donor.testNumber.trim() !== '') {
    name += `_${record.donor.testNumber.trim()}`;
  }
  const d = new Date(record.createdAt);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  name += `_${yyyy}${mm}${dd}`;
  return sanitizeFileName(name);
}

/**
 * Builds the report and writes it to the record's normal cached PDF location, updating
 * record.pdfPath. Mirrors PdfReportGenerator.java#generate.
 */
export async function generatePdf(record: TestRecord): Promise<string> {
  const html = await buildHtml(record);
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  if (!record.pdfDisplayName || record.pdfDisplayName.trim() === '') {
    record.pdfDisplayName = suggestFileName(record);
  }
  const outPath = await pdfFilePath(record.id, record.pdfDisplayName);
  await FileSystem.copyAsync({ from: uri, to: outPath });
  await FileSystem.deleteAsync(uri, { idempotent: true });
  record.pdfPath = outPath;
  return outPath;
}

/** Reuses record.pdfPath if it still points at a real file, otherwise rebuilds it fresh from the
 *  record's own data. Mirrors PdfReportGenerator.java#getOrGenerate. */
export async function getOrGeneratePdf(record: TestRecord): Promise<string> {
  if (record.pdfPath) {
    const info = await FileSystem.getInfoAsync(record.pdfPath);
    if (info.exists && info.size > 0) return record.pdfPath;
  }
  return generatePdf(record);
}

/**
 * Builds a report the same way generatePdf() does, but writes it to its own throwaway file and
 * never touches record.pdfPath — used only for the email-send path, so the emailed copy never
 * overwrites or gets confused with the full-quality copy used for local viewing/sharing. Caller
 * is responsible for deleting the returned file once the send is done with it. Mirrors
 * PdfReportGenerator.java#generateToTempFile + forEmail(): photos are shrunk further than the
 * local copy (see PHOTO_MAX_WIDTH_EMAIL's own doc) since this file travels as a base64 payload
 * straight in a Cloud Function callable request, where size affects reliability directly.
 */
export async function generatePdfToTempFile(record: TestRecord): Promise<string> {
  const html = await buildHtml(record, true);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return uri;
}

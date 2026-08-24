import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { TestRecord } from '../models/TestRecord';
import { ResultValue } from '../models/ResultValue';
import { SUBSTANCES, CONTROL_LINE_KEY } from '../models/DrugResult';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { colors } from '../theme';

/**
 * Full, read-only, every-field view of a test record — mirrors TestRecordDetailRenderer.java's
 * information architecture (same sections, same fields, same order), presented as grouped cards
 * rather than one long flat list so a 50+ field record stays scannable. Used by SummaryScreen's
 * review step, RecordDetailScreen, and Admin's opened records — same reuse pattern as native's
 * TestRecordDetailRenderer being shared between its Report screen and History detail view.
 */
export default function RecordDetailView({ record }: { record: TestRecord }) {
  return (
    <View>
      <Section title="Donor Information">
        <Row label="Initial consent confirmed" value={record.donor.initialConsentAgreed ? 'Yes' : 'No'} />
        <Row label="Test #" value={record.donor.testNumber} />
        <Row label="Donor ID" value={record.donor.donorId} />
        <Row label="Name" value={record.donor.firstName} />
        <Row label="Surname" value={record.donor.surname} />
        <Row label="Date of birth" value={formatDate(record.donor.dateOfBirth)} last={!record.donor.idPhotoPath} />
        <ImageRow label="Photo of donor ID" path={record.donor.idPhotoPath} height={200} />
        <Row
          label="Medication in last 7 days"
          value={record.donor.medicationLast7Days == null ? '-' : record.donor.medicationLast7Days ? 'Yes' : 'No'}
        />
        {record.donor.medicationLast7Days === true && (
          <Row label="Medication details" value={record.donor.medicationDetails} />
        )}
        <Row label="Declaration confirmed" value={record.donor.declarationAgreed ? 'Yes' : 'No'} last />
        <ImageRow label="Donor signature" path={record.donor.signaturePath} height={130} />
      </Section>

      <Section title="Test Setup">
        <Row label="Company" value={record.testSetup.company} />
        <Row label="Testing site" value={record.testSetup.testingSite} />
        <Row label="Reason for test" value={record.testSetup.reasonForTest} />
        <Row label="Supervisor on site" value={record.testSetup.supervisorOnSite} />
        <Row label="Support person" value={record.testSetup.supportPerson} />
        <Row label="Result recipient" value={record.testSetup.resultRecipient} />
        <Row label="Recipient e-mail" value={record.testSetup.recipientEmail} />
        <Row label="Location" value={record.testSetup.location} last />
      </Section>

      <Section title="Operator Consent">
        <Row label="Operator name" value={record.operatorConsent.operatorName} />
        <Row label="Operator ID" value={record.operatorConsent.operatorId} />
        <Row label="Phone number" value={record.operatorConsent.phoneNumber} />
        <Row
          label="NZQA qualified"
          value={
            record.operatorConsent.qualificationAvailable == null
              ? '-'
              : record.operatorConsent.qualificationAvailable
                ? 'Yes'
                : 'No'
          }
        />
        <Row label="Confirmed" value={record.operatorConsent.agreedNoDataMisuse ? 'Yes' : 'No'} last />
        <ImageRow label="Operator signature" path={record.operatorConsent.signaturePath} height={130} />
      </Section>

      <Section title="Test Kit Information">
        <Row label="Part No." value={record.testKitInfo.partNo} />
        <Row label="LOT No." value={record.testKitInfo.lotNo} />
        <Row
          label="Expiry date"
          value={formatDate(record.testKitInfo.expiryDate, record.testKitInfo.expiryDayKnown)}
          last
        />
      </Section>

      <Section title="Drug Test">
        <ImageRow path={record.drugTestPhotoPath} height={200} />
        <ResultRow label="Overall result" result={record.drugResult.overallResult} />
        {record.drugResult.overallResult === ResultValue.NON_NEGATIVE &&
          SUBSTANCES.filter((s) => s !== CONTROL_LINE_KEY).map((substance) => (
            <ResultRow key={substance} label={substance} result={record.drugResult.substanceResults[substance] ?? null} />
          ))}
        <ImageRow label="Operator confirmation signature" path={record.drugResult.confirmationSignaturePath} height={130} />
      </Section>

      <Section title="Alcohol Test">
        <Row label="Device serial #" value={record.alcoholTestInfo.deviceSerial} />
        <Row label="Calibration expiry" value={formatDate(record.alcoholTestInfo.calibrationExpiry)} />
        <Row label="Measurement unit" value={record.alcoholTestInfo.measurementUnit} />
        <Row label="First test date & time" value={formatDateTime(record.alcoholTestInfo.firstTestDateTime)} />
        <Row
          label="15 min waiting time"
          value={record.alcoholTestInfo.waiting15Min == null ? null : record.alcoholTestInfo.waiting15Min ? 'Yes' : 'No'}
        />
        {hasSecondTest(record) && (
          <Row label="Second test date & time" value={formatDateTime(record.alcoholTestInfo.secondTestDateTime)} />
        )}
        {hasSecondTest(record) ? (
          <>
            <ImageRow label="First test photo" path={record.alcoholTestPhotoPath} height={200} />
            <ImageRow label="Second test photo" path={record.alcoholTestPhotoPath2} height={200} />
          </>
        ) : (
          <ImageRow path={record.alcoholTestPhotoPath} height={200} />
        )}
        <ResultRow label="First test result" result={record.alcoholResult.firstTestResult} negLabel="Pass" nonNegLabel="Fail" />
        {hasSecondTest(record) && (
          <ResultRow
            label="Second test result"
            result={record.alcoholResult.secondTestResult}
            negLabel="Pass"
            nonNegLabel="Fail"
            last
          />
        )}
      </Section>

      <Section title="Final Sign-off">
        <Row label="Operator name" value={record.finalSignOff.operatorName} last />
        <ImageRow label="Signature" path={record.finalSignOff.signaturePath} height={130} />
      </Section>
    </View>
  );
}

function hasSecondTest(record: TestRecord): boolean {
  return record.alcoholTestInfo.secondTestDateTime != null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionAccent} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string | null | undefined; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value && value.trim() !== '' ? value : '-'}</Text>
    </View>
  );
}

function ResultRow({
  label,
  result,
  negLabel = 'Negative',
  nonNegLabel = 'Non-Negative',
  last,
}: {
  label: string;
  result: string | null;
  negLabel?: string;
  nonNegLabel?: string;
  last?: boolean;
}) {
  const negative = result === ResultValue.NEGATIVE;
  const nonNegative = result === ResultValue.NON_NEGATIVE;
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      {result == null ? (
        <Text style={styles.rowValue}>-</Text>
      ) : (
        <View style={[styles.resultPill, negative ? styles.resultPillNegative : styles.resultPillNonNegative]}>
          <Text style={[styles.resultPillText, negative ? styles.resultTextNegative : styles.resultTextNonNegative]}>
            {negative ? negLabel : nonNegLabel}
          </Text>
        </View>
      )}
    </View>
  );
}

function ImageRow({ label, path, height }: { label?: string; path: string | null; height: number }) {
  if (!path) {
    return label ? (
      <View style={styles.imageBlock}>
        <Text style={styles.imageLabel}>{label}</Text>
        <View style={[styles.imagePlaceholder, { height: height * 0.6 }]}>
          <Text style={styles.imagePlaceholderText}>No photo</Text>
        </View>
      </View>
    ) : null;
  }
  return (
    <View style={styles.imageBlock}>
      {label ? <Text style={styles.imageLabel}>{label}</Text> : null}
      <View style={styles.imageFrame}>
        <Image source={{ uri: path }} style={{ width: '100%', height }} resizeMode="contain" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  sectionAccent: { width: 4, height: 16, borderRadius: 2, backgroundColor: colors.brandAccent, marginRight: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.brandPrimary },
  sectionBody: { paddingHorizontal: 14, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLabel: { fontSize: 13, color: colors.textSecondary, flex: 1, paddingRight: 12 },
  rowValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  resultPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  resultPillNegative: { backgroundColor: '#E5F3E6' },
  resultPillNonNegative: { backgroundColor: '#FBEAEA' },
  resultPillText: { fontSize: 12, fontWeight: '700' },
  resultTextNegative: { color: colors.brandSuccess },
  resultTextNonNegative: { color: colors.brandDanger },
  imageBlock: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  imageLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: 6 },
  imageFrame: { borderRadius: 8, borderWidth: 1, borderColor: colors.divider, overflow: 'hidden', backgroundColor: colors.background },
  imagePlaceholder: { borderRadius: 8, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  imagePlaceholderText: { fontSize: 12, color: colors.textSecondary },
});

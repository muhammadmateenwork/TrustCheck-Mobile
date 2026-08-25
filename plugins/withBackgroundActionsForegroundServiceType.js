const { withAndroidManifest } = require('@expo/config-plugins');

const SERVICE_NAME = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';

/**
 * react-native-background-actions ships its own AndroidManifest.xml declaring
 * `<service android:name=".RNBackgroundActionsTask"/>` with no foregroundServiceType — but that
 * manifest only gets merged in by Gradle's manifest merger at BUILD time (from the library's own
 * AAR), not at `expo prebuild` time, so a plugin can't find-and-patch it the way you'd patch
 * something already in app.json's own generated manifest (verified directly: right after prebuild,
 * <service> is entirely absent from android/app/src/main/AndroidManifest.xml).
 *
 * Instead, this ADDS a second `<service>` declaration with the same fully-qualified name to the
 * app's own manifest, carrying only the foregroundServiceType attribute the library's version
 * lacks. Gradle's manifest merger combines same-name declarations from different manifests
 * (app + library) into one final element rather than duplicating it, as long as there's no
 * conflicting attribute value — a standard, supported pattern for exactly this situation (adding
 * an attribute a library's own manifest can't hardcode since it varies per consuming app). Without
 * this, Android 14 (API 34) throws MissingForegroundServiceTypeException, since a runtime-only
 * type (the `foregroundServiceType` option passed to BackgroundService.start() in
 * downloadQueue.ts) is no longer enough on its own — see that file's own doc.
 */
module.exports = function withBackgroundActionsForegroundServiceType(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;
    application.service = application.service ?? [];
    const alreadyDeclared = application.service.some((s) => s.$?.['android:name'] === SERVICE_NAME);
    if (!alreadyDeclared) {
      application.service.push({
        $: {
          'android:name': SERVICE_NAME,
          'android:foregroundServiceType': 'dataSync',
        },
      });
    }
    return config;
  });
};

const { expo } = require("./app.json");

/** Reversed iOS client id. Google sign-in returns to the app through this scheme. */
function googlePlugin() {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? "";
  const suffix = ".apps.googleusercontent.com";
  if (!clientId.endsWith(suffix)) return null;
  const id = clientId.slice(0, -suffix.length);
  if (!id || /[^A-Za-z0-9.-]/.test(id)) return null;
  return ["@react-native-google-signin/google-signin", { iosUrlScheme: `com.googleusercontent.apps.${id}` }];
}

const plugins = (expo.plugins ?? []).filter((plugin) => {
  const name = Array.isArray(plugin) ? plugin[0] : plugin;
  return name !== "@react-native-google-signin/google-signin" && name !== "expo-build-properties";
});
const google = googlePlugin();
if (google) plugins.push(google);

// react-native-maps 1.29.11 depends on WorkManager 2.9.1. SDK 58 release builds
// minify with R8. These keep rules preserve the constructors WorkManager
// reflects on. Full mode still constant-folds Class.getCanonicalName() to a
// string ending in ".canonicalName", so withDisableR8FullMode turns that off.
plugins.push([
  "expo-build-properties",
  {
    android: {
      extraProguardRules: [
        "-keep class * extends androidx.room.RoomDatabase { <init>(); }",
        "-keep class * extends androidx.work.InputMerger { <init>(); }",
      ].join("\n"),
    },
  },
]);
plugins.push("./plugins/withDisableR8FullMode");

module.exports = {
  expo: {
    ...expo,
    plugins,
    extra: {
      ...expo.extra,
      eas: {
        ...(expo.extra?.eas ?? {}),
        projectId: "d8a52062-36e1-47e0-8ff6-f80859cb470b",
      },
    },
  },
};

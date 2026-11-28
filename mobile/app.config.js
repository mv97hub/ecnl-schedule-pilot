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
// minify with R8 full mode, which drops Room's no-arg constructor. WorkManager's
// startup initializer then crashes the process before the first screen.
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

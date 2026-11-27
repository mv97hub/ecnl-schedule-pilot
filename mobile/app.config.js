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
  return name !== "@react-native-google-signin/google-signin";
});
const google = googlePlugin();
if (google) plugins.push(google);

module.exports = {
  expo: {
    ...expo,
    plugins,
  },
};

# Native messaging host manifests. They match what `tabherd setup` writes, except that the
# launcher is a store path that stays valid for as long as the package is installed.
{
  lib,
  launcher,
  extensionIds ? [ ],
  isDarwin ? false,
}:
let
  hostName = "com.tabherd.bridge";
  # Pinned by the manifest key in apps/extension/wxt.config.ts.
  chromiumId = "hepgdbeccdmbongocnnamapillglcbgk";
  firefoxId = "tabherd@local";
  common = {
    name = hostName;
    description = "Tabherd local browser bridge";
    path = launcher;
    type = "stdio";
  };
  support = "Library/Application Support";
in
{
  file = "${hostName}.json";
  chromium = builtins.toJSON (
    common
    // {
      allowed_origins = map (id: "chrome-extension://${id}/") (
        lib.unique ([ chromiumId ] ++ extensionIds)
      );
    }
  );
  firefox = builtins.toJSON (common // { allowed_extensions = [ firefoxId ]; });
  # Machine-wide directories under /etc on Linux. Firefox uses programs.firefox instead.
  etcDirectories = {
    chrome = "opt/chrome/native-messaging-hosts";
    chromium = "chromium/native-messaging-hosts";
    # Brave reads Chrome's directories on Linux and macOS (brave-core app/brave_main_delegate.cc).
    brave = "opt/chrome/native-messaging-hosts";
    edge = "opt/edge/native-messaging-hosts";
  };
  # Per-user directories relative to $HOME, as in packages/bridge/src/install.ts.
  userDirectories =
    if isDarwin then
      {
        chrome = "${support}/Google/Chrome/NativeMessagingHosts";
        chromium = "${support}/Chromium/NativeMessagingHosts";
        brave = "${support}/Google/Chrome/NativeMessagingHosts";
        edge = "${support}/Microsoft Edge/NativeMessagingHosts";
        firefox = "${support}/Mozilla/NativeMessagingHosts";
      }
    else
      {
        chrome = ".config/google-chrome/NativeMessagingHosts";
        chromium = ".config/chromium/NativeMessagingHosts";
        brave = ".config/google-chrome/NativeMessagingHosts";
        edge = ".config/microsoft-edge/NativeMessagingHosts";
        firefox = ".mozilla/native-messaging-hosts";
      };
}

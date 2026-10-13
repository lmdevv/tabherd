{
  lib,
  stdenvNoCC,
  nodejs-slim,
  pnpm,
  fetchPnpmDeps,
  pnpmConfigHook,
  makeWrapper,
}:
let
  root = ../.;
  manifests = import ./manifests.nix {
    inherit lib;
    launcher = "${placeholder "out"}/libexec/tabherd/native-host";
  };
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "tabherd";
  version = (lib.importJSON ../packages/bridge/package.json).version;

  # Only what the CLI build reads, so docs and extension edits don't rebuild it.
  src = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../apps/docs/package.json
      ../apps/extension/package.json
      ../packages/config
      ../packages/protocol/package.json
      ../packages/protocol/src
      ../packages/bridge/package.json
      ../packages/bridge/build.mjs
      ../packages/bridge/src
      ../packages/bridge/README.md
      ../packages/bridge/LICENSE
    ];
  };

  pnpmWorkspaces = [ "tabherd..." ];
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs)
      pname
      version
      src
      pnpmWorkspaces
      ;
    inherit pnpm;
    fetcherVersion = 4;
    # pnpm's store differs between Linux and macOS for this lockfile, so each has its own hash.
    hash =
      if stdenvNoCC.hostPlatform.isDarwin then
        "sha256-t4myVmZgLMDTTuc+ROs2OmNE9bJckEL2v5ELG6NTo/k="
      else
        "sha256-GBpR3LPmGuj4Zlk9w+lz5mXoCNx3XwhGNSDCi3Ni6yY=";
  };

  # Attributes, not files, so Nix substitutes the $out placeholder in the launcher path.
  chromiumManifest = manifests.chromium;
  firefoxManifest = manifests.firefox;

  nativeBuildInputs = [
    nodejs-slim
    pnpm
    pnpmConfigHook
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild
    # One self-contained file: there is no npm install step to provide node_modules.
    TABHERD_STANDALONE=1 pnpm --filter tabherd build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    lib=$out/lib/tabherd
    mkdir -p $lib/dist
    cp packages/bridge/dist/index.js packages/bridge/package.json packages/bridge/README.md packages/bridge/LICENSE $lib/
    mv $lib/index.js $lib/dist/index.js
    makeWrapper ${lib.getExe nodejs-slim} $out/bin/tabherd --add-flags $lib/dist/index.js
    # Browsers start this through the manifests below.
    makeWrapper ${lib.getExe nodejs-slim} $out/libexec/tabherd/native-host \
      --add-flags "$lib/dist/index.js native-host"
    # Layouts that nixpkgs' Firefox and Chromium wrappers and modules look for.
    for dir in etc/chromium etc/opt/chrome; do
      mkdir -p $out/$dir/native-messaging-hosts
      printf '%s' "$chromiumManifest" > $out/$dir/native-messaging-hosts/${manifests.file}
    done
    mkdir -p $out/lib/mozilla/native-messaging-hosts
    printf '%s' "$firefoxManifest" > $out/lib/mozilla/native-messaging-hosts/${manifests.file}
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    [ "$($out/bin/tabherd --version)" = "${finalAttrs.version}" ]
    runHook postInstallCheck
  '';

  meta = {
    description = "Your browser, connected to your agent: CLI, MCP server and native messaging host for the Tabherd extension";
    homepage = "https://github.com/lmdevv/tabherd";
    license = lib.licenses.mit;
    mainProgram = "tabherd";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
})

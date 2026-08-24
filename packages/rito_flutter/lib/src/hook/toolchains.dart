import 'dart:io';

import 'package:code_assets/code_assets.dart';
import 'package:hooks/hooks.dart';

import 'target.dart';

const String ritoAndroidNdkVersion = '28.2.13676358';

Future<Map<String, String>> ritoToolchainEnvironment({
  required RitoCargoTarget target,
  required CodeConfig codeConfig,
  Map<String, String>? platformEnvironment,
}) async {
  final environment = platformEnvironment ?? Platform.environment;
  if (target.targetOS == OS.android) {
    return _androidEnvironment(
      target: target,
      codeConfig: codeConfig,
      environment: environment,
    );
  }
  if (target.appleSdk case final sdk?) {
    return _appleEnvironment(target: target, sdk: sdk);
  }
  return const <String, String>{};
}

Map<String, String> _androidEnvironment({
  required RitoCargoTarget target,
  required CodeConfig codeConfig,
  required Map<String, String> environment,
}) {
  final ndk = _findAndroidNdk(
    environment,
    compiler: codeConfig.cCompiler?.compiler,
  );
  final hostTag = switch (Platform.operatingSystem) {
    'macos' => 'darwin-x86_64',
    'linux' => 'linux-x86_64',
    'windows' => 'windows-x86_64',
    final os => throw UnsupportedError('NDK host $os is not supported.'),
  };
  final bin = Directory(
    '${ndk.path}${Platform.pathSeparator}toolchains${Platform.pathSeparator}'
    'llvm${Platform.pathSeparator}prebuilt${Platform.pathSeparator}$hostTag'
    '${Platform.pathSeparator}bin',
  );
  if (!bin.existsSync()) {
    throw InfraError(message: 'NDK tool directory does not exist: ${bin.path}');
  }

  final rustTarget = target.rustTarget!;
  final compilerStem = '${target.androidClangPrefix}${target.androidApi}';
  final clang = _requiredTool(bin, '$compilerStem-clang');
  final clangxx = _requiredTool(bin, '$compilerStem-clang++');
  final ar = _requiredTool(bin, 'llvm-ar');
  final cargoKey = rustTarget.toUpperCase().replaceAll('-', '_');
  final ccKey = rustTarget.replaceAll('-', '_');
  return <String, String>{
    'ANDROID_NDK_HOME': ndk.path,
    'ANDROID_NDK_ROOT': ndk.path,
    'CARGO_TARGET_${cargoKey}_LINKER': clang.path,
    'CC_$ccKey': clang.path,
    'CXX_$ccKey': clangxx.path,
    'AR_$ccKey': ar.path,
  };
}

Future<Map<String, String>> _appleEnvironment({
  required RitoCargoTarget target,
  required String sdk,
}) async {
  ProcessResult result;
  try {
    result = await Process.run('xcrun', <String>[
      '--sdk',
      sdk,
      '--show-sdk-path',
    ]);
  } on ProcessException catch (error, stackTrace) {
    throw InfraError(
      message: 'Unable to locate the Apple $sdk SDK with xcrun.',
      wrappedException: error,
      wrappedTrace: stackTrace,
    );
  }
  if (result.exitCode != 0) {
    throw InfraError(
      message: 'xcrun failed for Apple SDK $sdk: ${result.stderr}',
    );
  }
  final sdkPath = result.stdout.toString().trim();
  if (sdkPath.isEmpty || !Directory(sdkPath).existsSync()) {
    throw InfraError(message: 'xcrun returned an invalid $sdk SDK path.');
  }
  return <String, String>{
    'SDKROOT': sdkPath,
    if (target.deploymentEnvironment case final name?)
      name: '${target.deploymentVersion}',
  };
}

Directory _findAndroidNdk(
  Map<String, String> environment, {
  required Uri? compiler,
}) {
  final candidates = <String, Directory>{};
  void add(String? path) {
    if (path == null || path.isEmpty) {
      return;
    }
    final directory = Directory(path);
    candidates[directory.absolute.path] = directory.absolute;
  }

  for (final key in <String>[
    'ANDROID_NDK',
    'ANDROID_NDK_HOME',
    'ANDROID_NDK_LATEST_HOME',
    'ANDROID_NDK_ROOT',
  ]) {
    add(environment[key]);
  }
  add(_ndkRootFromCompiler(compiler));
  final androidHome = environment['ANDROID_HOME'];
  if (androidHome != null) {
    add(
      '$androidHome${Platform.pathSeparator}ndk${Platform.pathSeparator}'
      '$ritoAndroidNdkVersion',
    );
  }
  final home = environment['HOME'] ?? environment['USERPROFILE'];
  if (home != null) {
    add('$home/Library/Android/sdk/ndk/$ritoAndroidNdkVersion');
    add('$home/Android/Sdk/ndk/$ritoAndroidNdkVersion');
    add('$home/AppData/Local/Android/Sdk/ndk/$ritoAndroidNdkVersion');
  }
  for (final candidate in candidates.values) {
    if (_isNdk28Dot2(candidate)) {
      return candidate;
    }
  }
  throw InfraError(
    message:
        'Android NDK $ritoAndroidNdkVersion was not found. Set '
        'ANDROID_HOME or an ANDROID_NDK_* variable to the installed NDK 28.2.',
  );
}

String? _ndkRootFromCompiler(Uri? compiler) {
  if (compiler == null || compiler.scheme != 'file') {
    return null;
  }
  final normalized = compiler.toFilePath().replaceAll('\\', '/');
  const marker = '/toolchains/llvm/prebuilt/';
  final markerIndex = normalized.indexOf(marker);
  return markerIndex < 0 ? null : normalized.substring(0, markerIndex);
}

bool _isNdk28Dot2(Directory directory) {
  final properties = File(
    '${directory.path}${Platform.pathSeparator}source.properties',
  );
  if (!properties.existsSync()) {
    return false;
  }
  try {
    for (final line in properties.readAsLinesSync()) {
      final fields = line.split('=');
      if (fields.length != 2 || fields.first.trim() != 'Pkg.Revision') {
        continue;
      }
      final revision = fields.last.trim();
      return revision == '28.2' || revision.startsWith('28.2.');
    }
  } on FileSystemException {
    return false;
  }
  return false;
}

File _requiredTool(Directory directory, String name) {
  for (final suffix in const <String>['', '.cmd', '.exe']) {
    final file = File('${directory.path}${Platform.pathSeparator}$name$suffix');
    if (file.existsSync()) {
      return file;
    }
  }
  throw InfraError(message: 'Required NDK tool is missing: $name');
}

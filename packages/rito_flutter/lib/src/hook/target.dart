import 'package:code_assets/code_assets.dart';

/// One target from one Native Assets hook invocation.
final class RitoCargoTarget {
  const RitoCargoTarget._({
    required this.targetOS,
    required this.architecture,
    required this.libraryFileName,
    this.rustTarget,
    this.androidClangPrefix,
    this.androidApi,
    this.appleSdk,
    this.deploymentEnvironment,
    this.deploymentVersion,
    this.ohosNativeRoot,
    this.ohosClangArguments = const <String>[],
  });

  factory RitoCargoTarget.fromCodeConfig(
    CodeConfig config, {
    required OS hostOS,
    required Architecture hostArchitecture,
  }) {
    final targetOS = config.targetOS;
    return RitoCargoTarget.resolve(
      targetOS: targetOS,
      architecture: config.targetArchitecture,
      hostOS: hostOS,
      hostArchitecture: hostArchitecture,
      iOSSdk: targetOS == OS.iOS ? config.iOS.targetSdk : null,
      androidApi: targetOS == OS.android ? config.android.targetNdkApi : null,
      deploymentVersion: switch (targetOS) {
        OS.iOS => config.iOS.targetVersion,
        OS.macOS => config.macOS.targetVersion,
        _ => null,
      },
      ohosNativeRoot: ohosNativeRootOf(config.cCompiler?.compiler),
    );
  }

  factory RitoCargoTarget.resolve({
    required OS targetOS,
    required Architecture architecture,
    required OS hostOS,
    required Architecture hostArchitecture,
    IOSSdk? iOSSdk,
    int? androidApi,
    int? deploymentVersion,
    String? ohosNativeRoot,
  }) {
    if (ohosNativeRoot != null &&
        (targetOS == OS.linux || targetOS.name == 'ohos')) {
      return _ohos(
        targetOS: targetOS,
        architecture: architecture,
        hostOS: hostOS,
        nativeRoot: ohosNativeRoot,
      );
    }
    if (targetOS == OS.android) {
      return _android(
        architecture: architecture,
        hostOS: hostOS,
        androidApi: androidApi,
      );
    }
    if (targetOS == OS.iOS) {
      return _iOS(
        architecture: architecture,
        hostOS: hostOS,
        sdk: iOSSdk,
        deploymentVersion: deploymentVersion,
      );
    }
    return _host(
      targetOS: targetOS,
      architecture: architecture,
      hostOS: hostOS,
      hostArchitecture: hostArchitecture,
      deploymentVersion: deploymentVersion,
    );
  }

  final OS targetOS;
  final Architecture architecture;
  final String libraryFileName;
  final String? rustTarget;
  final String? androidClangPrefix;
  final int? androidApi;
  final String? appleSdk;
  final String? deploymentEnvironment;
  final int? deploymentVersion;
  final String? ohosNativeRoot;
  final List<String> ohosClangArguments;

  static String? ohosNativeRootOf(Uri? compiler) {
    if (compiler == null || compiler.scheme != 'file') {
      return null;
    }
    final normalized = compiler.toFilePath().replaceAll('\\', '/');
    const root = '/openharmony/native';
    final index = normalized.indexOf('$root/llvm/bin/');
    return index < 0 ? null : normalized.substring(0, index + root.length);
  }

  List<String> get cargoTargetArguments => switch (rustTarget) {
    null => const <String>[],
    final target => <String>['--target', target],
  };

  Uri libraryUnder(Uri cargoTargetDirectory) {
    final releaseDirectory = switch (rustTarget) {
      null => cargoTargetDirectory.resolve('release/'),
      final target => cargoTargetDirectory.resolve('$target/release/'),
    };
    return releaseDirectory.resolve(libraryFileName);
  }

  static RitoCargoTarget _android({
    required Architecture architecture,
    required OS hostOS,
    required int? androidApi,
  }) {
    if (!<OS>{OS.macOS, OS.linux, OS.windows}.contains(hostOS)) {
      throw UnsupportedError(
        'Android Rust builds are not supported on $hostOS.',
      );
    }
    if (androidApi == null || androidApi < 1) {
      throw ArgumentError.value(androidApi, 'androidApi', 'must be positive');
    }
    final (rustTarget, clangPrefix) = switch (architecture) {
      Architecture.arm => (
        'armv7-linux-androideabi',
        'armv7a-linux-androideabi',
      ),
      Architecture.arm64 => ('aarch64-linux-android', 'aarch64-linux-android'),
      Architecture.x64 => ('x86_64-linux-android', 'x86_64-linux-android'),
      _ => throw UnsupportedError(
        'Android architecture $architecture is not supported by rito-ffi.',
      ),
    };
    return RitoCargoTarget._(
      targetOS: OS.android,
      architecture: architecture,
      rustTarget: rustTarget,
      libraryFileName: OS.android.dylibFileName('rito_ffi'),
      androidClangPrefix: clangPrefix,
      androidApi: androidApi,
    );
  }

  static RitoCargoTarget _ohos({
    required OS targetOS,
    required Architecture architecture,
    required OS hostOS,
    required String nativeRoot,
  }) {
    if (!<OS>{OS.macOS, OS.linux, OS.windows}.contains(hostOS)) {
      throw UnsupportedError(
        'OpenHarmony Rust builds are not supported on $hostOS.',
      );
    }
    final (rustTarget, clangArguments) = switch (architecture) {
      Architecture.arm64 => (
        'aarch64-unknown-linux-ohos',
        const <String>['--target=aarch64-linux-ohos'],
      ),
      Architecture.arm => (
        'armv7-unknown-linux-ohos',
        const <String>[
          '--target=arm-linux-ohos',
          '-march=armv7-a',
          '-mfloat-abi=softfp',
          '-mtune=generic-armv7-a',
          '-mthumb',
        ],
      ),
      Architecture.x64 => (
        'x86_64-unknown-linux-ohos',
        const <String>['--target=x86_64-linux-ohos'],
      ),
      _ => throw UnsupportedError(
        'OpenHarmony architecture $architecture is not supported by rito-ffi.',
      ),
    };
    return RitoCargoTarget._(
      targetOS: targetOS,
      architecture: architecture,
      rustTarget: rustTarget,
      libraryFileName: OS.linux.dylibFileName('rito_ffi'),
      ohosNativeRoot: nativeRoot,
      ohosClangArguments: clangArguments,
    );
  }

  static RitoCargoTarget _iOS({
    required Architecture architecture,
    required OS hostOS,
    required IOSSdk? sdk,
    required int? deploymentVersion,
  }) {
    if (hostOS != OS.macOS) {
      throw UnsupportedError('iOS Rust builds require a macOS host.');
    }
    if (sdk == null || deploymentVersion == null) {
      throw ArgumentError('iOS SDK and deployment version are required.');
    }
    final rustTarget = switch ((sdk, architecture)) {
      (IOSSdk.iPhoneOS, Architecture.arm64) => 'aarch64-apple-ios',
      (IOSSdk.iPhoneSimulator, Architecture.arm64) => 'aarch64-apple-ios-sim',
      (IOSSdk.iPhoneSimulator, Architecture.x64) => 'x86_64-apple-ios',
      _ => throw UnsupportedError(
        'iOS target $sdk/$architecture is not supported by rito-ffi.',
      ),
    };
    return RitoCargoTarget._(
      targetOS: OS.iOS,
      architecture: architecture,
      rustTarget: rustTarget,
      libraryFileName: OS.iOS.dylibFileName('rito_ffi'),
      appleSdk: sdk.type,
      deploymentEnvironment: 'IPHONEOS_DEPLOYMENT_TARGET',
      deploymentVersion: deploymentVersion,
    );
  }

  static RitoCargoTarget _host({
    required OS targetOS,
    required Architecture architecture,
    required OS hostOS,
    required Architecture hostArchitecture,
    required int? deploymentVersion,
  }) {
    if (!<OS>{OS.macOS, OS.linux, OS.windows}.contains(targetOS)) {
      throw UnsupportedError('Host target $targetOS is not supported.');
    }
    if (targetOS != hostOS) {
      throw UnsupportedError(
        'Cross-OS host build $hostOS -> $targetOS is not supported.',
      );
    }
    final rustTarget = architecture == hostArchitecture
        ? null
        : _crossHostRustTarget(targetOS, architecture);
    return RitoCargoTarget._(
      targetOS: targetOS,
      architecture: architecture,
      rustTarget: rustTarget,
      libraryFileName: targetOS.dylibFileName('rito_ffi'),
      appleSdk: targetOS == OS.macOS ? 'macosx' : null,
      deploymentEnvironment: targetOS == OS.macOS
          ? 'MACOSX_DEPLOYMENT_TARGET'
          : null,
      deploymentVersion: deploymentVersion,
    );
  }

  static String _crossHostRustTarget(OS targetOS, Architecture architecture) {
    if (targetOS != OS.macOS) {
      throw UnsupportedError(
        'Cross-architecture host builds are only supported on macOS.',
      );
    }
    return switch (architecture) {
      Architecture.arm64 => 'aarch64-apple-darwin',
      Architecture.x64 => 'x86_64-apple-darwin',
      _ => throw UnsupportedError(
        'macOS architecture $architecture is not supported by rito-ffi.',
      ),
    };
  }
}

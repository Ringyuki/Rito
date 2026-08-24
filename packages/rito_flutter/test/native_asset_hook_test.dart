import 'package:code_assets/code_assets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks/hooks.dart';
import 'package:rito_flutter/src/native/asset.dart';

import '../hook/src/cargo_builder.dart';
import '../hook/src/target.dart';

void main() {
  group('Rust target mapping', () {
    test('maps every supported Android ABI', () {
      expect(_android(Architecture.arm).rustTarget, 'armv7-linux-androideabi');
      expect(_android(Architecture.arm64).rustTarget, 'aarch64-linux-android');
      expect(_android(Architecture.x64).rustTarget, 'x86_64-linux-android');
      expect(_android(Architecture.arm).libraryFileName, 'librito_ffi.so');
      expect(
        _android(Architecture.arm).androidClangPrefix,
        'armv7a-linux-androideabi',
      );
      expect(_android(Architecture.arm64).androidApi, 23);
    });

    test('distinguishes iOS device and simulator targets', () {
      expect(
        _iOS(Architecture.arm64, IOSSdk.iPhoneOS).rustTarget,
        'aarch64-apple-ios',
      );
      expect(
        _iOS(Architecture.arm64, IOSSdk.iPhoneSimulator).rustTarget,
        'aarch64-apple-ios-sim',
      );
      expect(
        _iOS(Architecture.x64, IOSSdk.iPhoneSimulator).rustTarget,
        'x86_64-apple-ios',
      );
      expect(
        () => _iOS(Architecture.x64, IOSSdk.iPhoneOS),
        throwsUnsupportedError,
      );
    });

    test('uses the default toolchain for the current host tuple', () {
      final target = RitoCargoTarget.resolve(
        targetOS: OS.macOS,
        architecture: Architecture.arm64,
        hostOS: OS.macOS,
        hostArchitecture: Architecture.arm64,
        deploymentVersion: 13,
      );

      expect(target.rustTarget, isNull);
      expect(target.libraryFileName, 'librito_ffi.dylib');
      expect(target.appleSdk, 'macosx');
    });
  });

  test('Cargo plan is locked, release, isolated, unwind, and single-job', () {
    final workspace = RitoWorkspace(Uri.parse('file:///repo/'));
    final target = _android(Architecture.arm64);
    final plan = RitoCargoBuildPlan(
      workspace: workspace,
      outputDirectory: Uri.parse('file:///hook-output/config-a/'),
      target: target,
    );

    expect(plan.arguments, <String>[
      'build',
      '--release',
      '--locked',
      '--jobs',
      '1',
      '--package',
      'rito-ffi',
      '--target',
      'aarch64-linux-android',
    ]);
    expect(
      plan.environment['CARGO_TARGET_DIR'],
      '/hook-output/config-a/cargo-target/',
    );
    expect(plan.environment['CARGO_BUILD_JOBS'], '1');
    expect(plan.environment['CARGO_PROFILE_RELEASE_PANIC'], 'unwind');
    expect(
      plan.expectedLibrary,
      Uri.parse(
        'file:///hook-output/config-a/cargo-target/'
        'aarch64-linux-android/release/librito_ffi.so',
      ),
    );
  });

  test('repository workspace and Native Asset identifiers remain stable', () {
    final workspace = RitoWorkspace.fromPackageRoot(
      Uri.parse('file:///repo/packages/rito_flutter/'),
      pathExists: (_) => false,
    );

    expect(workspace.root, Uri.parse('file:///repo/'));
    expect(workspace.hookDependencies, contains(workspace.crates));
    expect(ritoNativeAssetName, 'src/native/bindings.dart');
    expect(ritoNativeAssetId, 'package:rito_flutter/src/native/bindings.dart');
  });

  test('a checkout compiles its live crates, not a stale snapshot', () {
    // The snapshot is generated for publishing and gitignored, so it
    // does not move when the crates do. Preferring it compiles an old
    // engine against new Dart and surfaces as a wire mismatch.
    final workspace = RitoWorkspace.fromPackageRoot(
      Uri.parse('file:///repo/packages/rito_flutter/'),
      pathExists: (path) =>
          path.endsWith('/native/Cargo.toml') ||
          path.endsWith('/crates/rito-core/Cargo.toml'),
    );

    expect(workspace.root, Uri.parse('file:///repo/'));
  });

  test('published packages use their bundled Rust workspace', () {
    final workspace = RitoWorkspace.fromPackageRoot(
      Uri.parse('file:///pub-cache/rito_flutter-0.1.0/'),
      pathExists: (path) => path.endsWith('/native/Cargo.toml'),
    );

    expect(
      workspace.root,
      Uri.parse('file:///pub-cache/rito_flutter-0.1.0/native/'),
    );
    expect(
      workspace.ffiManifest,
      Uri.parse(
        'file:///pub-cache/rito_flutter-0.1.0/'
        'native/crates/rito-ffi/Cargo.toml',
      ),
    );
  });

  group('Cargo executable discovery', () {
    const environment = <String, String>{
      'CARGO': '/configured/bin/cargo',
      'PATH': '/path/bin:/other/bin',
      'HOME': '/home/reader',
    };

    test('prefers CARGO over PATH and the Rust home fallback', () {
      final executable = ritoCargoExecutable(
        platformEnvironment: environment,
        pathExists: <String>{
          '/configured/bin/cargo',
          '/path/bin/cargo',
          '/home/reader/.cargo/bin/cargo',
        }.contains,
        pathSeparator: '/',
        pathListSeparator: ':',
        windows: false,
      );

      expect(executable, '/configured/bin/cargo');
    });

    test('uses PATH before the Rust home fallback', () {
      final executable = ritoCargoExecutable(
        platformEnvironment: environment,
        pathExists: <String>{
          '/path/bin/cargo',
          '/home/reader/.cargo/bin/cargo',
        }.contains,
        pathSeparator: '/',
        pathListSeparator: ':',
        windows: false,
      );

      expect(executable, '/path/bin/cargo');
    });

    test('falls back to the standard Rust home location', () {
      final executable = ritoCargoExecutable(
        platformEnvironment: environment,
        pathExists: const <String>{'/home/reader/.cargo/bin/cargo'}.contains,
        pathSeparator: '/',
        pathListSeparator: ':',
        windows: false,
      );

      expect(executable, '/home/reader/.cargo/bin/cargo');
    });

    test(
      'reports a deterministic infrastructure error when Cargo is absent',
      () {
        expect(
          () => ritoCargoExecutable(
            platformEnvironment: environment,
            pathExists: (_) => false,
            pathSeparator: '/',
            pathListSeparator: ':',
            windows: false,
          ),
          throwsA(isA<InfraError>()),
        );
      },
    );
  });
}

RitoCargoTarget _android(Architecture architecture) {
  return RitoCargoTarget.resolve(
    targetOS: OS.android,
    architecture: architecture,
    hostOS: OS.macOS,
    hostArchitecture: Architecture.arm64,
    androidApi: 23,
  );
}

RitoCargoTarget _iOS(Architecture architecture, IOSSdk sdk) {
  return RitoCargoTarget.resolve(
    targetOS: OS.iOS,
    architecture: architecture,
    hostOS: OS.macOS,
    hostArchitecture: Architecture.arm64,
    iOSSdk: sdk,
    deploymentVersion: 13,
  );
}

import 'package:code_assets/code_assets.dart';
import 'package:hooks/hooks.dart';
import 'package:rito_flutter/src/native/asset.dart';

import 'package:rito_flutter/src/hook/cargo_builder.dart';
import 'package:rito_flutter/src/hook/target.dart';
import 'package:rito_flutter/src/hook/toolchains.dart';

Future<void> main(List<String> arguments) async {
  await build(arguments, (input, output) async {
    if (!input.config.buildCodeAssets) {
      return;
    }
    try {
      await _buildRitoAsset(input, output);
    } on HookError {
      rethrow;
    } on Object catch (error, stackTrace) {
      throw BuildError(
        message: 'Unable to build the rito-ffi Native Asset: $error',
        wrappedException: error,
        wrappedTrace: stackTrace,
      );
    }
  });
}

Future<void> _buildRitoAsset(
  BuildInput input,
  BuildOutputBuilder output,
) async {
  if (input.packageName != ritoNativeAssetPackage) {
    throw BuildError(
      message:
          'Native Asset id expects package $ritoNativeAssetPackage, got '
          '${input.packageName}.',
    );
  }
  final codeConfig = input.config.code;
  if (codeConfig.linkModePreference == LinkModePreference.static) {
    throw BuildError(message: 'rito-ffi requires dynamic Native Assets.');
  }
  if (codeConfig.sanitizer != null) {
    throw BuildError(
      message: 'rito-ffi does not yet support sanitizer Native Asset builds.',
    );
  }

  final workspace = RitoWorkspace.fromPackageRoot(input.packageRoot);
  workspace.validate();
  final target = RitoCargoTarget.fromCodeConfig(
    codeConfig,
    hostOS: OS.current,
    hostArchitecture: Architecture.current,
  );
  final toolchainEnvironment = await ritoToolchainEnvironment(
    target: target,
    codeConfig: codeConfig,
  );
  final plan = RitoCargoBuildPlan(
    workspace: workspace,
    outputDirectory: input.outputDirectory,
    target: target,
    toolchainEnvironment: toolchainEnvironment,
  );

  output.dependencies.addAll(workspace.hookDependencies);
  final library = await const RitoCargoBuilder().build(plan);
  output.assets.code.add(
    CodeAsset(
      package: input.packageName,
      name: ritoNativeAssetName,
      linkMode: DynamicLoadingBundled(),
      file: library,
    ),
  );
}

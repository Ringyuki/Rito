import 'package:flutter/material.dart';
import 'package:rito_flutter/rito_flutter_native.dart';

void main() {
  runApp(const RitoExampleApp());
}

/// Minimal adapter build-smoke host: referencing the isolate gateway forces
/// the Rust Native Asset to compile and link for the target platform.
class RitoExampleApp extends StatelessWidget {
  const RitoExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Center(
          child: Text('rito_flutter adapter host: $RitoIsolateGateway'),
        ),
      ),
    );
  }
}

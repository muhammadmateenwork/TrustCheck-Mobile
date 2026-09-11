// exceljs (used for the Test Analytics XLSX export) was built for Node and expects the global
// Buffer API to exist -- RN/Hermes has no such global by default. Shimming it here, before
// anything else loads, is the standard way RN projects make Node-oriented libraries like this
// work; without it, exceljs's own internal Buffer.from() calls would throw at runtime the moment
// an export is attempted, not at build/type-check time.
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

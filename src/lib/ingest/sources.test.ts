import assert from 'node:assert/strict';
import { parseSourceRows, resolveSources } from './sources';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log('ok   -', name);
  } catch (e) {
    failures += 1;
    console.error('FAIL -', name, '\n     ', (e as Error).message);
  }
}

check('parse: null → empty', () => {
  assert.deepEqual(parseSourceRows(null), []);
});

check('parse: invalid JSON → empty', () => {
  assert.deepEqual(parseSourceRows('{not json'), []);
});

check('parse: non-array → empty', () => {
  assert.deepEqual(parseSourceRows('{"path":"/a"}'), []);
});

check('parse: trims path and tag', () => {
  assert.deepEqual(parseSourceRows('[{"path":"  /a  ","tag":"  work  "}]'), [
    { path: '/a', tag: 'work' },
  ]);
});

check('parse: empty tag → default', () => {
  assert.deepEqual(parseSourceRows('[{"path":"/a","tag":"   "}]'), [
    { path: '/a', tag: 'default' },
  ]);
});

check('parse: drops empty-path rows', () => {
  assert.deepEqual(parseSourceRows('[{"path":"","tag":"x"},{"path":"/a","tag":"y"}]'), [
    { path: '/a', tag: 'y' },
  ]);
});

check('parse: dedups by path, first tag wins', () => {
  assert.deepEqual(
    parseSourceRows('[{"path":"/a","tag":"first"},{"path":"/a","tag":"second"}]'),
    [{ path: '/a', tag: 'first' }],
  );
});

check('resolve: empty → fallback tagged default', () => {
  assert.deepEqual(resolveSources(null, '/home/u/.claude/projects'), [
    { path: '/home/u/.claude/projects', tag: 'default' },
  ]);
});

check('resolve: passes through non-empty rows', () => {
  assert.deepEqual(resolveSources('[{"path":"/a","tag":"work"}]', '/fallback'), [
    { path: '/a', tag: 'work' },
  ]);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall source tests passed');

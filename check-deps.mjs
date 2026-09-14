import yaml from 'js-yaml';
if (typeof yaml.load !== 'function' || typeof yaml.dump !== 'function') {
  throw new Error('js-yaml dependency is incomplete. Run npm ci.');
}

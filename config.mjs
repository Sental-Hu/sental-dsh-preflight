import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function loadConfig(directory, env = process.env) {
  const file = path.join(directory, 'launcher-config.json');
  let saved = {};
  if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const repository = env.DSH_LAUNCHER_REPO || saved.repository;
  if (typeof repository !== 'string' || !path.isAbsolute(repository)) {
    throw new Error('Set an absolute DSH repository path with Install-Launcher.ps1 -RepositoryPath.');
  }
  const repo = path.resolve(repository);
  if (!fs.existsSync(path.join(repo, 'apps/cli/lib/bin.js'))) {
    throw new Error('DSH build is missing: apps/cli/lib/bin.js. Build DSH before installing the launcher.');
  }
  const home = env.DSH_HOME || saved.home || path.join(os.homedir(), '.dsh');
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error('DSH_HOME must be an absolute path.');
  if (!fs.existsSync(path.join(home, 'profiles/web/package.json'))) {
    throw new Error('DSH web profile is missing. Initialize it with the DSH CLI before installing the launcher.');
  }
  return { repo, home: path.resolve(home) };
}

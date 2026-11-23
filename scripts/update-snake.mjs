import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('The snake generator requires Node.js 24 or newer.');
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = execFileSync('git', ['remote', 'get-url', 'origin'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'arief-profile-snake-'));
const source = join(temporaryDirectory, 'source');
const output = join(temporaryDirectory, 'output');
const generatorRevision = 'd8f6715049803e982ee5ff501b6b9b7d5deeb09b';

try {
  let token = process.env.GITHUB_TOKEN;
  if (!token) {
    const credential = execFileSync('git', ['credential', 'fill'], {
      cwd: root,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    });
    token = credential.split(/\r?\n/).find((line) => line.startsWith('password='))?.slice(9);
  }
  if (!token) {
    throw new Error('Set GITHUB_TOKEN or sign in to GitHub through your Git credential helper.');
  }

  execFileSync('git', ['init', '--quiet', source]);
  execFileSync('git', ['fetch', '--quiet', '--depth', '1',
    'https://github.com/Platane/snk.git', generatorRevision], { cwd: source });
  execFileSync('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: source });

  const outputBranch = execFileSync('git', ['ls-remote', '--heads', origin, 'refs/heads/output'], {
    encoding: 'utf8',
  }).trim();
  if (outputBranch) {
    execFileSync('git', ['clone', '--quiet', '--single-branch', '--branch', 'output', origin, output]);
  } else {
    execFileSync('git', ['init', '--quiet', '-b', 'output', output]);
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: output });
  }

  const generation = spawnSync(process.execPath, [join(source, 'svg-only/dist/index.js')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_TOKEN: token,
      INPUT_GITHUB_USER_NAME: 'ariefmavlana',
      INPUT_OUTPUTS: [
        `${join(output, 'github-snake.svg').replaceAll('\\', '/')}?color_snake=%23526b50&color_dots=%23f6f5f1,%23cbd7c4,%239bad8f,%236f8864,%23475f42`,
        `${join(output, 'github-snake-dark.svg').replaceAll('\\', '/')}?palette=github-dark&color_snake=%23a4bc98&color_dots=%23161b18,%2339433b,%235e7559,%238ba17d,%23b6cba7`,
      ].join('\n'),
    },
  });
  if (generation.error) throw generation.error;
  if (generation.status !== 0) {
    throw new Error(`Snake generation failed: ${generation.stderr || generation.stdout}`.replaceAll(token, '[REDACTED]'));
  }

  for (const file of ['github-snake.svg', 'github-snake-dark.svg']) {
    const svg = readFileSync(join(output, file), 'utf8');
    if (!svg.startsWith('<svg ') || !svg.includes('@keyframes') || !svg.endsWith('</svg>')) {
      throw new Error(`The generator did not produce an animated SVG: ${file}`);
    }
  }

  for (const key of ['user.name', 'user.email']) {
    const value = execFileSync('git', ['config', key], { cwd: root, encoding: 'utf8' }).trim();
    execFileSync('git', ['config', key, value], { cwd: output });
  }
  execFileSync('git', ['add', '--', 'github-snake.svg', 'github-snake-dark.svg'], { cwd: output });
  const changes = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: output });
  if (changes.error) throw changes.error;
  if (changes.status === 1) {
    execFileSync('git', ['commit', '--quiet', '-m', 'chore: refresh contribution snake'], { cwd: output });
    execFileSync('git', ['push', 'origin', 'HEAD:output'], { cwd: output, stdio: 'inherit' });
    console.log('Published both contribution snake images to origin/output.');
  } else if (changes.status === 0) {
    console.log('Contribution snake images are already up to date.');
  } else {
    throw new Error('Could not inspect the generated contribution snake changes.');
  }
} finally {
  if (!resolve(temporaryDirectory).startsWith(`${resolve(tmpdir())}${sep}`)) {
    throw new Error('Refusing to remove a directory outside the temporary directory.');
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

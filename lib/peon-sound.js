const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// peon-ping's master sound switch is the presence of `.paused` in its hook dir.
function peonDir(env = process.env, home = os.homedir()) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return path.join(claudeDir, 'hooks', 'peon-ping');
}

function isMuted(dir = peonDir()) {
  return fs.existsSync(path.join(dir, '.paused'));
}

// Prefer `peon.sh pause|resume` so peon-ping also syncs its adapters' .paused files.
// Fall back to touching the file directly if the script is missing or fails.
function setMuted(muted, dir = peonDir()) {
  return new Promise((resolve) => {
    const script = path.join(dir, 'peon.sh');
    const fallback = () => {
      try {
        const file = path.join(dir, '.paused');
        if (muted) fs.writeFileSync(file, '');
        else fs.rmSync(file, { force: true });
      } catch { /* dir missing — report actual state below */ }
      resolve(isMuted(dir));
    };
    if (!fs.existsSync(script)) return fallback();
    execFile('bash', [script, muted ? 'pause' : 'resume'], { timeout: 5000 }, (err) => {
      if (err) return fallback();
      resolve(isMuted(dir));
    });
  });
}

module.exports = { peonDir, isMuted, setMuted };

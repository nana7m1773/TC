export TC_TOOLING_DIR="${TC_TOOLING_DIR:-/workspace/.tooling}"
export JAVA_HOME="$TC_TOOLING_DIR/jdk-21.0.8+9"
export ANDROID_HOME="$TC_TOOLING_DIR/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_USER_HOME="$TC_TOOLING_DIR/android-user"
export XDG_CONFIG_HOME="$TC_TOOLING_DIR/config"
export XDG_CACHE_HOME="$TC_TOOLING_DIR/cache"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
export GRADLE_USER_HOME="$TC_TOOLING_DIR/gradle-cache"
export PATH="$JAVA_HOME/bin:$TC_TOOLING_DIR/gradle-8.11.1/bin:$ANDROID_HOME/cmdline-tools/19.0/bin:$ANDROID_HOME/platform-tools:$PATH"
# JVM clients do not inherit the cloud HTTPS proxy or Debian CA trust by default.
# Read existing bindings at runtime without persisting credential values.
eval "$(python3 - <<'PY'
import os, shlex
from pathlib import Path
from urllib.parse import urlsplit
options = []
for scheme in ('http', 'https'):
    raw = os.environ.get(scheme.upper() + '_PROXY')
    if raw:
        proxy = urlsplit(raw)
        if proxy.hostname and proxy.port:
            options.extend([f'-D{scheme}.proxyHost={proxy.hostname}', f'-D{scheme}.proxyPort={proxy.port}'])
nonproxy = []
for item in os.environ.get('NO_PROXY', '').split(','):
    item = item.strip()
    if item:
        nonproxy.append('*' + item if item.startswith('.') else item)
if nonproxy:
    options.append('-Dhttp.nonProxyHosts=' + '|'.join(nonproxy))
if os.path.isfile('/etc/ssl/certs/java/cacerts'):
    options.append('-Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts')
combined = ' '.join(filter(None, [os.environ.get('JAVA_OPTS', ''), shlex.join(options)]))
# Gradle starts a separate daemon; JAVA_OPTS configures only its client.
# Runtime systemProp entries are forwarded by Gradle to the daemon.
props_path = Path(os.environ.get('GRADLE_USER_HOME', "$TC_TOOLING_DIR/gradle-cache")) / 'gradle.properties'
props_path.parent.mkdir(parents=True, exist_ok=True)
begin = '# BEGIN cloud runtime network settings'
end = '# END cloud runtime network settings'
existing = props_path.read_text() if props_path.exists() else ''
if begin in existing and end in existing:
    before, remainder = existing.split(begin, 1)
    _, after = remainder.split(end, 1)
    existing = before.rstrip() + after
settings = []
for option in options:
    key, value = option[2:].split('=', 1)
    settings.append('systemProp.' + key + '=' + value.replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '\\r'))
props_path.write_text(existing.rstrip() + ('\n' if existing.strip() else '') + begin + '\n' + '\n'.join(settings) + '\n' + end + '\n')
print('export JAVA_OPTS=' + shlex.quote(combined))
PY
)"

#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def normalize(path: str) -> str:
    path = (path or "").replace('\\', '/').strip()
    while '//' in path:
        path = path.replace('//', '/')
    if path.startswith('./'):
        path = path[2:]
    try:
        resolved = Path(path)
        if resolved.is_absolute():
            path = resolved.resolve().relative_to(ROOT.resolve()).as_posix()
    except Exception:
        pass
    return path


def is_secret(path: str) -> bool:
    p = normalize(path)
    name = p.split('/')[-1].lower()

    if not p:
        return False

    if name == '.env':
        return True
    if name.startswith('.env.') and name != '.env.example':
        return True
    if p == 'k8s/secret.yaml':
        return True
    if any(token in name for token in ['secret', 'secrets', 'credential', 'credentials']):
        if name not in {'.env.example'}:
            return True
    if name.endswith(('.pem', '.key', '.p12', '.pfx')):
        return True
    return False


def high_risk_reason(path: str):
    p = normalize(path)
    if not p:
        return None

    checks = [
        ('src/controllers/attendance.controller.js', 'attendance final-state logic'),
        ('src/jobs/', 'scheduler or job-driven state mutation'),
        ('src/middlewares/authJwt.js', 'auth/session contract'),
        ('src/middlewares/roleGuard.js', 'authorization boundary'),
        ('src/config/', 'runtime or deploy configuration'),
        ('src/utils/fuzzyAhpEngine.js', 'FAHP core logic'),
        ('src/analytics/fahp', 'FAHP analytical logic'),
        ('src/analytics/config.fahp.js', 'FAHP configuration logic'),
        ('.env.example', 'environment contract'),
        ('k8s/configmap.yaml', 'deploy/runtime config truth'),
        ('k8s/app-deployment.yaml', 'deploy/runtime topology'),
        ('.do/app.yaml', 'deploy/runtime topology'),
        ('.do/app-production.yaml', 'deploy/runtime topology'),
        ('.github/workflows/', 'CI or deployment workflow'),
    ]

    for prefix, reason in checks:
        if prefix.endswith('/'):
            if p.startswith(prefix):
                return reason
        elif prefix.endswith('fahp'):
            if p.startswith(prefix) and p.endswith('.js'):
                return reason
        elif p == prefix:
            return reason
    return None


def collect_paths(tool_input: dict):
    paths = []
    for key in ('file_path', 'notebook_path'):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            paths.append(value)
    return paths


def branch_push_guard(command: str):
    if not isinstance(command, str):
        return None

    compact = ' '.join(command.strip().split())
    if not compact.startswith('git push'):
        return None

    branch_match = re.search(r'\b(?:origin\s+)?([A-Za-z0-9._/-]+)(?::[A-Za-z0-9._/-]+)?\s*$', compact)
    branch = branch_match.group(1) if branch_match else None

    if branch == 'master':
        return {
            'continue': False,
            'stopReason': 'Blocked: do not push directly to master. Promote reviewed and QA-passed work from develop via PR.',
            'systemMessage': 'BRANCH GUARD: Direct push to master is blocked. Use review branch -> develop -> master promotion flow.',
            'hookSpecificOutput': {
                'hookEventName': 'PreToolUse',
                'permissionDecision': 'deny',
                'permissionDecisionReason': 'Direct push to master is blocked by project branch workflow policy'
            }
        }

    if branch == 'develop':
        return {
            'systemMessage': 'BRANCH GUARD: Push to develop is allowed but should be exceptional. Preferred flow: feature/review branch -> PR -> develop, then QA/review before promote to master.',
            'hookSpecificOutput': {
                'hookEventName': 'PreToolUse',
                'permissionDecision': 'allow',
                'permissionDecisionReason': 'Push to develop warned by project branch workflow policy'
            }
        }

    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return

    tool_input = payload.get('tool_input') or {}

    command_guard = branch_push_guard(tool_input.get('command'))
    if command_guard:
        print(json.dumps(command_guard))
        return

    paths = collect_paths(tool_input)
    if not paths:
        return

    normalized = [normalize(p) for p in paths if normalize(p)]
    if not normalized:
        return

    blocked = [p for p in normalized if is_secret(p)]
    if blocked:
        out = {
            'continue': False,
            'stopReason': 'Blocked: editing real secret-bearing files is not allowed through project hooks.',
            'systemMessage': 'SECRET GUARD: This repo blocks edits to real secret-bearing files: ' + ', '.join(blocked),
            'hookSpecificOutput': {
                'hookEventName': 'PreToolUse',
                'permissionDecision': 'deny',
                'permissionDecisionReason': 'Real secret-bearing file matched project secret guard'
            }
        }
        print(json.dumps(out))
        return

    flagged = []
    for p in normalized:
        reason = high_risk_reason(p)
        if reason:
            flagged.append((p, reason))

    if flagged:
        lines = [f'- {path} ({reason})' for path, reason in flagged]
        message = (
            'SENSITIVE FILE WARNING: You are about to modify high-risk backend logic. '\
            'Re-check current state, source-of-truth, risks, and verification plan before proceeding.\n' +
            '\n'.join(lines)
        )
        out = {
            'systemMessage': message,
            'hookSpecificOutput': {
                'hookEventName': 'PreToolUse',
                'permissionDecision': 'allow',
                'permissionDecisionReason': 'High-risk backend file warning only; not a hard block'
            }
        }
        print(json.dumps(out))


if __name__ == '__main__':
    main()

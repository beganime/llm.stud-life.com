#!/usr/bin/env bash
# Запустите на сервере llm.stud-life.com под своим пользователем:
#   bash grant-access.sh
# Скрипт добавит публичный ключ Kimi в ~/.ssh/authorized_keys
set -euo pipefail

KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPViOJ3XnV2p+EFKM1GXCnjcDqDEwSZ6RMRdWWLe//nn kimi-deploy-llm-compare'

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"

if grep -qF "$KEY" "$HOME/.ssh/authorized_keys"; then
  echo "Ключ уже добавлен."
else
  echo "$KEY" >> "$HOME/.ssh/authorized_keys"
  echo "Ключ добавлен для пользователя $(whoami)@$(hostname)."
fi

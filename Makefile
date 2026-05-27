MIN ?= 5
DIR ?=

.PHONY: help focus-great-again dev diagnose pause resume stop-today backup restore

help: ## Список целей
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

focus-great-again: ## Полная установка (brew/node/pnpm → db → capture → permissions → launchagent)
	./scripts/bootstrap.sh

dev: ## Запуск дашборда локально
	pnpm -w run dev

diagnose: ## Проверка здоровья системы
	./scripts/diagnose.sh

pause: ## Пауза захвата (MIN=5 по умолчанию)
	./scripts/pause.sh $(MIN)

resume: ## Снять паузу
	./scripts/resume.sh

stop-today: ## Стоп до 9:00 завтра
	./scripts/stop-today.sh

backup: ## Бэкап settings + db + .env
	./scripts/backup-local.sh

restore: ## Восстановление (make restore DIR=~/focus-track-backup/...)
	./scripts/restore-local.sh $(DIR)

.DEFAULT_GOAL := help

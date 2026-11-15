# SquatClient (Wails v2 desktop app). Requires Go >= 1.24, Node >= 20 and the
# Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2`).
# The Go workspace (../go.work) must include ../squatClientDaemon for local engine development.
WAILS       ?= $(shell command -v wails 2>/dev/null || echo $(HOME)/go/bin/wails)
STATICCHECK ?= $(shell command -v staticcheck 2>/dev/null || echo $(HOME)/go/bin/staticcheck)
FRONTEND    := frontend

.PHONY: dev build frontend test test-go test-frontend lint lint-go lint-frontend icon run

dev:
	$(WAILS) dev

# Frontend first (so //go:embed all:frontend/dist is real), then the app bundle.
BUILD_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)$(shell git diff --quiet 2>/dev/null || echo -dirty)
BUILD_TIME := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
# Diagnostics policy (docs/DIAGNOSTICS.md): always (alpha default: logging is on from the first start) | optin | off (compiled out).
# The repository and the private-delivery contact can be overridden too: make build REPO_SLUG=owner/name
DIAG_MODE    ?= always
REPO_SLUG    ?= itsnotyoutoday/squatclient
CONTACT_NAME ?= Nveid
CONTACT_HOST ?= startrekkin.net
CONTACT_PORT ?= 1701
BUILD_LDFLAGS = -X main.buildCommit=$(BUILD_COMMIT) -X main.buildTime=$(BUILD_TIME) -X main.diagnosticsMode=$(DIAG_MODE) -X main.repoSlug=$(REPO_SLUG) -X main.contactName=$(CONTACT_NAME) -X main.contactHost=$(CONTACT_HOST) -X main.contactPort=$(CONTACT_PORT)
build: frontend
	$(WAILS) build -ldflags "$(BUILD_LDFLAGS)"

frontend: $(FRONTEND)/node_modules
	cd $(FRONTEND) && npm run build

$(FRONTEND)/node_modules: $(FRONTEND)/package.json
	cd $(FRONTEND) && npm install

test: test-go test-frontend

test-go:
	go test -race ./...

test-frontend: $(FRONTEND)/node_modules
	cd $(FRONTEND) && npm test

lint: lint-go lint-frontend

lint-go:
	@test -z "$$(gofmt -l .)" || (gofmt -l . && echo "gofmt needed" && exit 1)
	go vet ./...
	$(STATICCHECK) ./...

lint-frontend: $(FRONTEND)/node_modules
	cd $(FRONTEND) && npm run typecheck && npm run lint

# The icon is drawn in build/icon-source/squatter.svg. Render it to build/appicon.png (1024x1024,
# transparent; e.g. headless Chrome --screenshot) and Wails builds the platform icons from that.
# (scripts/genicon.go is the old generated placeholder and would overwrite the artwork.)
icon:
	@echo "edit build/icon-source/squatter.svg, then render it to build/appicon.png (see the Makefile comment)"

run: build
	open build/bin/squatclient.app

// Package seeds встраивает базовые узлы карты в бинарник.
package seeds

import _ "embed"

//go:embed base_markets.json
var BaseMarkets []byte

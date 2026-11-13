package db

import (
	"context"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// OpenNeo4j создаёт драйвер и проверяет соединение.
func OpenNeo4j(ctx context.Context, uri, user, password string) (neo4j.DriverWithContext, error) {
	driver, err := neo4j.NewDriverWithContext(uri, neo4j.BasicAuth(user, password, ""))
	if err != nil {
		return nil, err
	}
	if err := driver.VerifyConnectivity(ctx); err != nil {
		_ = driver.Close(ctx)
		return nil, err
	}
	return driver, nil
}

// PingNeo4j выполняет RETURN 1.
func PingNeo4j(ctx context.Context, driver neo4j.DriverWithContext) bool {
	res, err := neo4j.ExecuteQuery(ctx, driver, "RETURN 1 AS ok", nil, neo4j.EagerResultTransformer)
	if err != nil || len(res.Records) == 0 {
		return false
	}
	v, _ := res.Records[0].Get("ok")
	n, ok := v.(int64)
	return ok && n == 1
}

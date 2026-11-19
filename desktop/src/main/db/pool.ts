import mysql from 'mysql2/promise'
import type { DbConfig } from '../config'

export type Pool = mysql.Pool

export function createPool(cfg: DbConfig): Pool {
  return mysql.createPool({
    host: cfg.host, port: cfg.port, user: cfg.database ? cfg.user : undefined,
    password: cfg.password, database: cfg.database,
    waitForConnections: true, connectionLimit: 5, connectTimeout: 4000,
    timezone: 'Z', dateStrings: false, supportBigNumbers: true
  })
}

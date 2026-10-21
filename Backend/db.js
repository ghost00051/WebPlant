import 'dotenv/config'
import { Sequelize } from "sequelize"

function readInt(value, fallback) {
    const parsed = Number.parseInt(value, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST || "localhost",
        port: process.env.DB_PORT || 5432,
        dialect: "postgres",
        logging: false,
        define: {
            timestamps: false
        },
        pool: {
            max: readInt(process.env.DB_POOL_MAX, 10),
            min: readInt(process.env.DB_POOL_MIN, 0),
            acquire: readInt(process.env.DB_POOL_ACQUIRE_MS, 15_000),
            idle: readInt(process.env.DB_POOL_IDLE_MS, 10_000),
            evict: readInt(process.env.DB_POOL_EVICT_MS, 1_000)
        },
        dialectOptions: {
            statement_timeout: readInt(process.env.DB_STATEMENT_TIMEOUT_MS, 30_000),
            query_timeout: readInt(process.env.DB_QUERY_TIMEOUT_MS, 30_000),
            application_name: 'webplant-backend'
        },
        retry: {
            max: readInt(process.env.DB_RETRY_MAX, 2)
        }
    }
)

export default sequelize

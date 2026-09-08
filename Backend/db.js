import { Sequelize } from "sequelize"
import dotenv from "dotenv"

dotenv.config()

const sequelize = new Sequelize(
    process.env.PGDATABASE,        
    process.env.PGUSER,        
    process.env.PGPASSWORD,    
    {
        host: process.env.DB_HOST || "localhost",
        port: process.env.DB_PORT || 5432,
        dialect: "postgres",
        logging: false,        
        define: {
            timestamps: false  
        }
    }
)

export default sequelize
import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const User = sequelize.define("user", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    email: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    username: {
        type: DataTypes.STRING(30),
        allowNull: true,
        unique: true
    },
    phone: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    bio: {
        type: DataTypes.STRING(300),
        allowNull: true
    },
    role: {
        type: DataTypes.ENUM("USER", "ADMIN"),
        defaultValue: "USER"
    },
    privilege_level: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "free"
    }
}, {
    tableName: 'users',
    timestamps: false,
    indexes: [
        {
            name: 'idx_users_username_unique',
            unique: true,
            fields: ['username']
        }
    ]
})

export default User
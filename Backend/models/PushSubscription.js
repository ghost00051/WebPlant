import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const PushSubscription = sequelize.define("push_subscription", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    endpoint: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true
    },
    p256dh: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    auth: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'push_subscriptions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { name: 'idx_push_user', fields: ['user_id'] },
        { name: 'idx_push_endpoint', fields: ['endpoint'], unique: true }
    ]
})

export default PushSubscription
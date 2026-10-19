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
    },
    last_success_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    last_error: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    failed_attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    invalidated_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    invalid_reason: {
        type: DataTypes.STRING(120),
        allowNull: true
    }
}, {
    tableName: 'push_subscriptions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { name: 'idx_push_user', fields: ['user_id'] },
        { name: 'idx_push_endpoint', fields: ['endpoint'], unique: true },
        { name: 'idx_push_subscriptions_invalidated_at', fields: ['invalidated_at'] }
    ]
})

export default PushSubscription

import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const BotMessage = sequelize.define('bot_message', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    channel: {
        type: DataTypes.STRING(16),
        allowNull: false
    },
    direction: {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: 'out',
        comment: 'in — сообщение от пользователя, out — ответ/доставка бота'
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    bot_link_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'bot_links',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    external_user_id: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    notification_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'notifications',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    kind: {
        type: DataTypes.STRING(32),
        allowNull: true
    },
    status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        comment: 'sent / failed / skipped / received'
    },
    error: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    latency_ms: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    command: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    payload: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    sent_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'bot_messages',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        {
            name: 'idx_bot_messages_channel_created',
            fields: ['channel', 'created_at']
        },
        {
            name: 'idx_bot_messages_user_created',
            fields: ['user_id', 'created_at']
        },
        {
            name: 'idx_bot_messages_status_created',
            fields: ['status', 'created_at']
        },
        {
            name: 'idx_bot_messages_kind_created',
            fields: ['kind', 'created_at']
        }
    ]
})

export default BotMessage

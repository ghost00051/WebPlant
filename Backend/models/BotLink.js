import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const BotLink = sequelize.define('bot_link', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    channel: {
        type: DataTypes.STRING(16),
        allowNull: false,
        comment: 'Канал доставки: telegram или max'
    },
    external_user_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: 'id пользователя в мессенджере (всегда строкой)'
    },
    username: {
        type: DataTypes.STRING(128),
        allowNull: true
    },
    display_name: {
        type: DataTypes.STRING(128),
        allowNull: true
    },
    notifications_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    linked_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    unlinked_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    last_inbound_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    }
}, {
    tableName: 'bot_links',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            name: 'idx_bot_links_channel_external',
            unique: true,
            fields: ['channel', 'external_user_id']
        },
        {
            name: 'idx_bot_links_user_channel_active',
            unique: true,
            fields: ['user_id', 'channel'],
            where: { is_active: true }
        },
        {
            name: 'idx_bot_links_channel_active',
            fields: ['channel', 'is_active']
        },
        {
            name: 'idx_bot_links_user_active',
            fields: ['user_id', 'is_active']
        }
    ]
})

export default BotLink

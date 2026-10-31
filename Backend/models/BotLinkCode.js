import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const BotLinkCode = sequelize.define('bot_link_code', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    code: {
        type: DataTypes.STRING(64),
        allowNull: false
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
        allowNull: false
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false
    },
    used_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'bot_link_codes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        {
            name: 'idx_bot_link_codes_code',
            unique: true,
            fields: ['code']
        },
        {
            name: 'idx_bot_link_codes_user_channel',
            fields: ['user_id', 'channel']
        }
    ]
})

export default BotLinkCode

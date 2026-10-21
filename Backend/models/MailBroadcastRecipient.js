import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const MailBroadcastRecipient = sequelize.define('mail_broadcast_recipient', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    broadcast_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'mail_broadcasts',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    email: {
        type: DataTypes.STRING(254),
        allowNull: false
    },
    status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'pending',
        validate: {
            isIn: [['pending', 'sent', 'failed', 'skipped']]
        }
    },
    attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    error: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    sent_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'mail_broadcast_recipients',
    timestamps: false,
    indexes: [
        {
            name: 'idx_mail_broadcast_recipients_unique',
            unique: true,
            fields: ['broadcast_id', 'user_id']
        },
        {
            name: 'idx_mail_broadcast_recipients_status',
            fields: ['broadcast_id', 'status']
        }
    ]
})

export default MailBroadcastRecipient

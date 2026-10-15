import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const MailBroadcast = sequelize.define('mail_broadcast', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    subject: {
        type: DataTypes.STRING(200),
        allowNull: false
    },
    body: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    cta_label: {
        type: DataTypes.STRING(80),
        allowNull: true
    },
    cta_url: {
        type: DataTypes.STRING(2048),
        allowNull: true
    },
    target_mode: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: {
            isIn: [['all', 'users']]
        }
    },
    status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'pending',
        validate: {
            isIn: [['pending', 'sending', 'sent', 'failed', 'canceled']]
        }
    },
    scheduled_for: {
        type: DataTypes.DATE,
        allowNull: true
    },
    sent_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    total_recipients: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    sent_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    failed_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    skipped_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'SET NULL'
    }
}, {
    tableName: 'mail_broadcasts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        {
            name: 'idx_mail_broadcasts_status_scheduled',
            fields: ['status', 'scheduled_for']
        },
        {
            name: 'idx_mail_broadcasts_created',
            fields: ['created_at', 'id']
        }
    ]
})

export default MailBroadcast

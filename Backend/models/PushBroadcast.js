import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const PushBroadcast = sequelize.define('push_broadcast', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    title: {
        type: DataTypes.STRING(120),
        allowNull: false
    },
    body: {
        type: DataTypes.STRING(1000),
        allowNull: false
    },
    icon: {
        type: DataTypes.STRING(2048),
        allowNull: true
    },
    url: {
        type: DataTypes.STRING(2048),
        allowNull: false,
        defaultValue: '/'
    },
    target_mode: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: {
            isIn: [['all', 'users']]
        }
    },
    include_guests: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
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
    total_subscriptions: {
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
    removed_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },

    idempotency_key: {
        type: DataTypes.STRING(200),
        allowNull: true
    },

    started_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    last_processed_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    chunk_size: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 200,
        validate: {
            min: 1,
            max: 500
        }
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
    tableName: 'push_broadcasts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        {
            name: 'idx_push_broadcasts_status_scheduled',
            fields: ['status', 'scheduled_for']
        },
        {
            name: 'idx_push_broadcasts_created',
            fields: ['created_at', 'id']
        },
        {
            name: 'idx_push_broadcasts_idempotency',
            unique: true,
            fields: ['idempotency_key']
        },
        {
            name: 'idx_push_broadcasts_status_updated',
            fields: ['status', 'updated_at']
        }
    ]
})

export default PushBroadcast

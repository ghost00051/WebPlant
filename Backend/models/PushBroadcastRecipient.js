import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const PushBroadcastRecipient = sequelize.define('push_broadcast_recipient', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    broadcast_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'push_broadcasts',
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
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'push_broadcast_recipients',
    timestamps: false,
    indexes: [
        {
            name: 'idx_push_broadcast_recipients_unique',
            unique: true,
            fields: ['broadcast_id', 'user_id']
        }
    ]
})

export default PushBroadcastRecipient

import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const Notification = sequelize.define('notification', {
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
    plant_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        validate: {
            isIn: [['watering_due', 'watering_day_before', 'morning_summary']]
        }
    },
    title: {
        type: DataTypes.STRING(120),
        allowNull: false
    },
    body: {
        type: DataTypes.STRING(1000),
        allowNull: false
    },
    url: {
        type: DataTypes.STRING(2048),
        allowNull: false,
        defaultValue: '/home'
    },
    dedupe_key: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    scheduled_for: {
        type: DataTypes.DATE,
        allowNull: true
    },
    read_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'notifications',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        {
            name: 'idx_notifications_user_created',
            fields: ['user_id', 'created_at', 'id']
        },
        {
            name: 'idx_notifications_user_read',
            fields: ['user_id', 'read_at']
        },
        {
            name: 'idx_notifications_user_dedupe',
            unique: true,
            fields: ['user_id', 'dedupe_key']
        }
    ]
})

export default Notification

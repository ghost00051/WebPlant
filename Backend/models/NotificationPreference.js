import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const NotificationPreference = sequelize.define('notification_preference', {
    user_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        references: {
            model: 'users',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    morning_summary_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    care_advice_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    last_care_advice_date: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    dark_theme_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    theme_mode: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'system',
        validate: {
            isIn: [['system', 'light', 'dark']]
        }
    },
    last_morning_summary_date: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    weekly_recap_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Недельный recap (F10): push/боты + e-mail при согласии'
    },
    last_weekly_recap_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: 'Дата понедельника последнего отправленного recap'
    }
}, {
    tableName: 'notification_preferences',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})

export default NotificationPreference

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
    },
    delivery_mode: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'digest',
        comment: 'F41: digest — одна сводка в день, per_plant — отдельное напоминание на растение',
        validate: {
            isIn: [['digest', 'per_plant']]
        }
    },
    quiet_hours_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'F43: не доставлять push/ботов/письма в тихие часы'
    },
    quiet_hours_start: {
        type: DataTypes.STRING(5),
        allowNull: false,
        defaultValue: '22:00',
        comment: 'F43: начало тихих часов, локальное время пользователя HH:MM'
    },
    quiet_hours_end: {
        type: DataTypes.STRING(5),
        allowNull: false,
        defaultValue: '08:00',
        comment: 'F43: конец тихих часов, локальное время пользователя HH:MM'
    }
}, {
    tableName: 'notification_preferences',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})

export default NotificationPreference

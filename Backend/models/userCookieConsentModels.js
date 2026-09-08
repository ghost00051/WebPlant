import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const UserCookieConsent = sequelize.define("user_cookie_consent", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },

    guest_token: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Уникальный идентификатор неавторизованного пользователя'
    },
    consent_type: {
        type: DataTypes.ENUM('technical', 'analytics', 'marketing', 'personalization'),
        allowNull: false,
        defaultValue: 'technical'
    },
    is_accepted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    version: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: '1.0'
    },
    accepted_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    is_revoked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    revoked_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    revoked_reason: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true
    },
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    source: {
        type: DataTypes.ENUM('banner', 'settings', 'registration', 'legal_update',
            'registration_linked',
            'login_linked'
        ),
        allowNull: true,
        defaultValue: 'banner'
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {}
    }
}, {
    tableName: 'user_cookie_consents',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            name: 'idx_user_consents_user_id',
            fields: ['user_id']
        },
        {
            name: 'idx_guest_token',
            fields: ['guest_token']
        },
        {
            name: 'idx_user_consents_type',
            fields: ['consent_type']
        },
        {
            name: 'idx_user_consents_accepted',
            fields: ['is_accepted']
        },
        {
            name: 'idx_user_consents_revoked',
            fields: ['is_revoked']
        },
        {
            name: 'idx_user_consents_created',
            fields: ['created_at']
        }
    ]
})

export default UserCookieConsent
import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const UserLegalConsent = sequelize.define("user_legal_consent", {
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
    consent_type: {
        type: DataTypes.ENUM(
            'privacy_policy', 
            'terms_of_service'
        ),
        allowNull: false
    },
    is_accepted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    document_version: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: '1.0'
    },
    accepted_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    revoked_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    guest_token: {
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
        type: DataTypes.ENUM('registration', 'settings', 'banner', 'legal_update'),
        allowNull: true,
        defaultValue: 'registration'
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {}
    }
}, {
    tableName: 'user_legal_consents',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            name: 'idx_legal_user_id',
            fields: ['user_id']
        },
        {
            name: 'idx_legal_type',
            fields: ['consent_type']
        },
        {
            name: 'idx_legal_guest',
            fields: ['guest_token']
        }
    ]
})

export default UserLegalConsent
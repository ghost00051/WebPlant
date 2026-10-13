import sequelize from '../db.js'
import { DataTypes } from 'sequelize'
import User from './userModels.js'

const PasswordResetToken = sequelize.define('password_reset_token', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
    },
    token_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false
    },
    used_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    requested_ip: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'password_reset_tokens',
    timestamps: false,
    indexes: [
        { name: 'idx_password_reset_tokens_user_id', fields: ['user_id'] },
        { name: 'idx_password_reset_tokens_expires', fields: ['expires_at'] }
    ]
})

PasswordResetToken.belongsTo(User, { foreignKey: 'user_id', as: 'user' })

export default PasswordResetToken

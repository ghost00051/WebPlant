import sequelize from '../db.js'
import { DataTypes } from 'sequelize'
import User from './userModels.js'

const AuthSession = sequelize.define('auth_session', {
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
    token_type: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['session', 'refresh']] }
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false
    },
    revoked_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'auth_sessions',
    timestamps: false,
    indexes: [
        { name: 'idx_auth_sessions_user_id', fields: ['user_id'] },
        { name: 'idx_auth_sessions_expires', fields: ['expires_at'] }
    ]
})

AuthSession.belongsTo(User, { foreignKey: 'user_id', as: 'user' })

export default AuthSession

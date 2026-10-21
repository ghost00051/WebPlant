import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const AdminAuditLog = sequelize.define('admin_audit_log', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    admin_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL'
    },
    action: {
        type: DataTypes.STRING(64),
        allowNull: false
    },
    target_type: {
        type: DataTypes.STRING(32),
        allowNull: true
    },
    target_id: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    payload: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    ip: {
        type: DataTypes.INET,
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
    tableName: 'admin_audit_logs',
    timestamps: false
})

export default AdminAuditLog

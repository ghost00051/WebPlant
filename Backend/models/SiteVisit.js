import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const SiteVisit = sequelize.define("site_visit_day", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    visitor_id: {
        type: DataTypes.STRING(64),
        allowNull: false
    },
    day: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL'
    },
    views: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    first_path: {
        type: DataTypes.STRING(300),
        allowNull: true
    },
    referrer_host: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    device: {
        type: DataTypes.STRING(16),
        allowNull: true
    }
}, {
    tableName: 'site_visit_days',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { name: 'idx_site_visit_days_visitor_day', unique: true, fields: ['visitor_id', 'day'] },
        { name: 'idx_site_visit_days_day', fields: ['day'] },
        { name: 'idx_site_visit_days_user', fields: ['user_id', 'day'] }
    ]
})

export default SiteVisit

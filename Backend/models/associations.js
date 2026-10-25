import WateringLog from './WateringLog.js'
import PlantCareLog from './PlantCareLog.js'
import User from './userModels.js'
import Plant from './Plant.js'
import PlantPhoto from './PlantPhoto.js'
import ChatLog from './ChatLog.js'
import AiAdviceLog from './AiAdviceLog.js'
import AdminAuditLog from './AdminAuditLog.js'
import ProductEvent from './ProductEvent.js'
import GardenShare from './GardenShare.js'
import GardenShareSignup from './GardenShareSignup.js'
import './Passkey.js'
import './PasskeyChallenge.js'

User.hasMany(Plant, {
    foreignKey: 'user_id',
    as: 'plants',
    onDelete: 'CASCADE'
})

User.hasMany(ChatLog, { foreignKey: 'user_id', onDelete: 'CASCADE' })
ChatLog.belongsTo(User, { foreignKey: 'user_id' })

User.hasMany(AiAdviceLog, { foreignKey: 'user_id', onDelete: 'SET NULL' })
AiAdviceLog.belongsTo(User, { foreignKey: 'user_id' })

Plant.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
})

Plant.hasMany(PlantPhoto, {
    foreignKey: 'plant_id',
    as: 'photos',
    onDelete: 'CASCADE'
})
PlantPhoto.belongsTo(Plant, {
    foreignKey: 'plant_id',
    as: 'plant'
})

Plant.hasMany(WateringLog, { foreignKey: 'plant_id', as: 'wateringLogs', onDelete: 'CASCADE' })
WateringLog.belongsTo(Plant, { foreignKey: 'plant_id', as: 'plant' })

User.hasMany(WateringLog, { foreignKey: 'user_id', onDelete: 'CASCADE' })
WateringLog.belongsTo(User, { foreignKey: 'user_id' })

Plant.hasMany(PlantCareLog, { foreignKey: 'plant_id', as: 'careLogs', onDelete: 'CASCADE' })
PlantCareLog.belongsTo(Plant, { foreignKey: 'plant_id', as: 'plant' })

User.hasMany(PlantCareLog, { foreignKey: 'user_id', as: 'careLogs', onDelete: 'CASCADE' })
PlantCareLog.belongsTo(User, { foreignKey: 'user_id' })

User.hasMany(AdminAuditLog, {
    foreignKey: 'admin_id',
    as: 'auditLogs',
    onDelete: 'SET NULL'
})
AdminAuditLog.belongsTo(User, {
    foreignKey: 'admin_id',
    as: 'admin'
})

User.hasMany(ProductEvent, {
    foreignKey: 'user_id',
    as: 'productEvents',
    onDelete: 'SET NULL'
})
ProductEvent.belongsTo(User, { foreignKey: 'user_id' })

User.hasMany(GardenShare, {
    foreignKey: 'user_id',
    as: 'gardenShares',
    onDelete: 'CASCADE'
})
GardenShare.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
})

GardenShare.hasMany(GardenShareSignup, {
    foreignKey: 'share_id',
    as: 'signups',
    onDelete: 'CASCADE'
})
GardenShareSignup.belongsTo(GardenShare, {
    foreignKey: 'share_id',
    as: 'share'
})

User.hasMany(GardenShareSignup, {
    foreignKey: 'user_id',
    as: 'gardenShareSignups',
    onDelete: 'CASCADE'
})
GardenShareSignup.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
})

export {
    User,
    Plant,
    PlantPhoto,
    AdminAuditLog,
    ProductEvent,
    GardenShare,
    GardenShareSignup
}

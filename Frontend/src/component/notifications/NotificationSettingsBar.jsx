import { DELIVERY_MODE_DIGEST, DELIVERY_MODE_PER_PLANT } from '../../utils/notificationsExtraApi.js'

function NotificationSettingsBar({
  deliveryMode,
  onDeliveryModeChange,
  quietSummary,
  channelsSummary,
  saving,
  status,
  onOpenChannels,
  onOpenQuiet
}) {
  const digestMode = deliveryMode === DELIVERY_MODE_DIGEST
  const perPlantMode = deliveryMode === DELIVERY_MODE_PER_PLANT

  return (
    <section className='notificationsSettings' aria-label='Настройки уведомлений'>
      <div className='notificationsSettingsRow'>
        <div
          className='notificationsMode'
          role='group'
          aria-label='Режим уведомлений'
        >
          <button
            type='button'
            className={`notificationsModeButton${digestMode ? ' is-active' : ''}`}
            aria-pressed={digestMode}
            onClick={() => onDeliveryModeChange(DELIVERY_MODE_DIGEST)}
            disabled={Boolean(saving)}
          >
            Сводка
          </button>
          <button
            type='button'
            className={`notificationsModeButton${perPlantMode ? ' is-active' : ''}`}
            aria-pressed={perPlantMode}
            onClick={() => onDeliveryModeChange(DELIVERY_MODE_PER_PLANT)}
            disabled={Boolean(saving)}
          >
            По растениям
          </button>
        </div>

        <div className='notificationsSettingsButtons'>
          <button
            type='button'
            className='notificationsSettingsButton'
            onClick={onOpenChannels}
          >
            Каналы
            {channelsSummary && (
              <span className='notificationsSettingsBadge'>{channelsSummary}</span>
            )}
          </button>
          <button
            type='button'
            className='notificationsSettingsButton'
            onClick={onOpenQuiet}
          >
            Тихие часы
            {quietSummary && (
              <span className='notificationsSettingsBadge'>{quietSummary}</span>
            )}
          </button>
        </div>
      </div>

      <p className='notificationsSettingsHint'>
        {digestMode
          ? 'Одна сводка в день вместо сообщений по каждому растению.'
          : 'Отдельное напоминание по каждому растению — как раньше.'}
      </p>

      {status?.text && (
        <p
          className={`notificationsSettingsStatus notificationsSettingsStatus--${status.tone || 'info'}`}
          role={status.tone === 'error' ? 'alert' : 'status'}
        >
          {status.text}
        </p>
      )}
    </section>
  )
}

export default NotificationSettingsBar

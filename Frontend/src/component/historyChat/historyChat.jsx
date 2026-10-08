import NewChatBtn from '../../assets/NewChatBtn.svg'
import './historyChat.css'

function HistoryChat() {
    return (
        <div className="HistoryChat">
            <div className='headerOfHistoryChat'>
                <p>История чата</p>
                <img src={NewChatBtn} alt="" />
            </div>
            <div className='mainOfHistoryChat'>
                <p>В процессе разрабботки</p>
            </div>
        </div>
    )
}

export default HistoryChat
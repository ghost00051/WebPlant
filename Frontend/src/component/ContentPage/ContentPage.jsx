import SiteHeader from '../SiteHeader/SiteHeader.jsx'
import SiteFooter from '../SiteFooter/SiteFooter.jsx'
import './ContentPage.css'

function ContentPage({ activePath, children }) {
    return (
        <div className='contentPage'>
            <SiteHeader activePath={activePath} />
            <main className='contentPageMain'>{children}</main>
            <SiteFooter />
        </div>
    )
}

export default ContentPage

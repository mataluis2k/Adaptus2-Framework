/**
 * E-commerce Analytics Overview Endpoint
 * Provides analytics data for the dashboard from the tracking database
 */

const { getDbConnection } = require('../db');

class AnalyticsOverviewService {
    constructor(globalContext, dbConfig) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.registerActions();
    }

    registerActions() {
        this.globalContext.actions.get_analytics_overview = this.getAnalyticsOverview.bind(this);
    }

    /**
     * Get overview analytics data for the dashboard
     * @param {Object} ctx - Context object with configuration
     * @param {Object} params - Request parameters
     * @param {string} params.period - Time period (7d, 30d, 90d)
     * @param {string} params.siteId - Optional site ID for multi-site setups
     */
    async getAnalyticsOverview(ctx, params) {
        const connection = await getDbConnection(ctx.config.db);
        try {
            // Determine date range based on period parameter
            const { startDate, endDate, previousStartDate, previousEndDate } = this._getDateRanges(params.period);
            
            // Gather all the required metrics
            const [
                revenueMetrics,
                orderMetrics,
                visitorMetrics,
                conversionMetrics,
                cartMetrics
            ] = await Promise.all([
                this._getRevenueMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, params.siteId),
                this._getOrderMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, params.siteId),
                this._getVisitorMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, params.siteId),
                this._getConversionMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, params.siteId),
                this._getCartMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, params.siteId)
            ]);
            
            // Calculate additional derived metrics
            const averageOrderValue = revenueMetrics.totalRevenue / orderMetrics.totalOrders || 0;
            const previousAOV = revenueMetrics.previousRevenue / orderMetrics.previousOrders || 0;
            const aovChange = previousAOV > 0 ? ((averageOrderValue - previousAOV) / previousAOV) * 100 : 0;
            
            // Combine all metrics into a single response object
            return {
                period: params.period,
                totalRevenue: revenueMetrics.totalRevenue,
                revenueChange: revenueMetrics.revenueChange,
                averageOrderValue: averageOrderValue,
                aovChange: aovChange,
                conversionRate: conversionMetrics.conversionRate,
                conversionChange: conversionMetrics.conversionChange,
                totalOrders: orderMetrics.totalOrders,
                ordersChange: orderMetrics.ordersChange,
                totalVisitors: visitorMetrics.totalVisitors,
                visitorsChange: visitorMetrics.visitorsChange,
                cartAbandonment: cartMetrics.abandonmentRate,
                abandonmentChange: cartMetrics.abandonmentChange,
                // Additional metrics for extended dashboard functionality
                newUsers: visitorMetrics.newUsers,
                returningUsers: visitorMetrics.returningUsers,
                newUsersChange: visitorMetrics.newUsersChange,
                dailyActiveUsers: visitorMetrics.dailyActiveUsers,
                checkoutCompletionRate: conversionMetrics.checkoutCompletionRate
            };
        } catch (error) {
            console.error("Error in getAnalyticsOverview:", error);
            throw new Error("Failed to retrieve analytics overview: " + error.message);
        } finally {
            connection.release();
        }
    }

    /**
     * Calculate date ranges for current and previous periods
     * @private
     */
    _getDateRanges(period) {
        const endDate = new Date();
        let startDate = new Date();
        let days;
        
        switch(period) {
            case '30d':
                days = 30;
                break;
            case '90d':
                days = 90;
                break;
            case '7d':
            default:
                days = 7;
                break;
        }
        
        startDate.setDate(endDate.getDate() - days);
        
        // Previous period (for comparison)
        const previousEndDate = new Date(startDate);
        previousEndDate.setDate(previousEndDate.getDate() - 1);
        
        const previousStartDate = new Date(previousEndDate);
        previousStartDate.setDate(previousStartDate.getDate() - days);
        
        // Format dates for SQL queries
        return {
            startDate: this._formatDateForSQL(startDate),
            endDate: this._formatDateForSQL(endDate),
            previousStartDate: this._formatDateForSQL(previousStartDate),
            previousEndDate: this._formatDateForSQL(previousEndDate)
        };
    }

    /**
     * Format date for SQL queries
     * @private
     */
    _formatDateForSQL(date) {
        return date.toISOString().slice(0, 19).replace('T', ' ');
    }

    /**
     * Get revenue metrics
     * @private
     */
    async _getRevenueMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, siteId) {
        const siteFilter = siteId ? ' AND e.event_data->"$.siteId" = ?' : '';
        const params = siteId ? [startDate, endDate, siteId] : [startDate, endDate];
        const prevParams = siteId ? [previousStartDate, previousEndDate, siteId] : [previousStartDate, previousEndDate];
        
        // Get current period revenue
        const [currentRevenue] = await connection.query(
            `SELECT COALESCE(SUM(p.revenue), 0) as total_revenue
             FROM purchases p
             JOIN events e ON p.event_id = e.event_id
             WHERE e.event_time BETWEEN ? AND ?${siteFilter}`,
            params
        );
        
        // Get previous period revenue
        const [previousRevenue] = await connection.query(
            `SELECT COALESCE(SUM(p.revenue), 0) as total_revenue
             FROM purchases p
             JOIN events e ON p.event_id = e.event_id
             WHERE e.event_time BETWEEN ? AND ?${siteFilter}`,
            prevParams
        );
        
        const totalRevenue = currentRevenue[0].total_revenue || 0;
        const prevTotalRevenue = previousRevenue[0].total_revenue || 0;
        
        // Calculate percentage change
        const revenueChange = prevTotalRevenue > 0 
            ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100 
            : 0;
        
        return {
            totalRevenue,
            previousRevenue: prevTotalRevenue,
            revenueChange
        };
    }

    /**
     * Get order metrics
     * @private
     */
    async _getOrderMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, siteId) {
        const siteFilter = siteId ? ' AND e.event_data->"$.siteId" = ?' : '';
        const params = siteId ? [startDate, endDate, siteId] : [startDate, endDate];
        const prevParams = siteId ? [previousStartDate, previousEndDate, siteId] : [previousStartDate, previousEndDate];
        
        // Current period orders
        const [currentOrders] = await connection.query(
            `SELECT COUNT(DISTINCT p.transaction_id) as total_orders
             FROM purchases p
             JOIN events e ON p.event_id = e.event_id
             WHERE e.event_time BETWEEN ? AND ?${siteFilter}`,
            params
        );
        
        // Previous period orders
        const [previousOrders] = await connection.query(
            `SELECT COUNT(DISTINCT p.transaction_id) as total_orders
             FROM purchases p
             JOIN events e ON p.event_id = e.event_id
             WHERE e.event_time BETWEEN ? AND ?${siteFilter}`,
            prevParams
        );
        
        const totalOrders = currentOrders[0].total_orders || 0;
        const prevTotalOrders = previousOrders[0].total_orders || 0;
        
        // Calculate percentage change
        const ordersChange = prevTotalOrders > 0 
            ? ((totalOrders - prevTotalOrders) / prevTotalOrders) * 100 
            : 0;
        
        return {
            totalOrders,
            previousOrders: prevTotalOrders,
            ordersChange
        };
    }

    /**
     * Get visitor metrics
     * @private
     */
    async _getVisitorMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, siteId) {
        const siteFilter = siteId ? ' AND e.event_data->"$.siteId" = ?' : '';
        const params = siteId ? [startDate, endDate, siteId] : [startDate, endDate];
        const prevParams = siteId ? [previousStartDate, previousEndDate, siteId] : [previousStartDate, previousEndDate];
        
        // Current period visitors
        const [currentVisitors] = await connection.query(
            `SELECT 
                COUNT(DISTINCT s.session_id) as total_sessions,
                COUNT(DISTINCT u.user_id) as total_visitors,
                COUNT(DISTINCT CASE WHEN u.first_seen BETWEEN ? AND ? THEN u.user_id ELSE NULL END) as new_users,
                COUNT(DISTINCT CASE WHEN u.first_seen < ? THEN u.user_id ELSE NULL END) as returning_users
             FROM sessions s
             JOIN users u ON s.user_id = u.user_id
             JOIN events e ON s.session_id = e.session_id
             WHERE s.started_at BETWEEN ? AND ?${siteFilter}`,
            [startDate, endDate, startDate, startDate, endDate, ...(siteId ? [siteId] : [])]
        );
        
        // Previous period visitors
        const [previousVisitors] = await connection.query(
            `SELECT 
                COUNT(DISTINCT s.session_id) as total_sessions,
                COUNT(DISTINCT u.user_id) as total_visitors,
                COUNT(DISTINCT CASE WHEN u.first_seen BETWEEN ? AND ? THEN u.user_id ELSE NULL END) as new_users
             FROM sessions s
             JOIN users u ON s.user_id = u.user_id
             JOIN events e ON s.session_id = e.session_id
             WHERE s.started_at BETWEEN ? AND ?${siteFilter}`,
            [previousStartDate, previousEndDate, previousStartDate, previousEndDate, ...(siteId ? [siteId] : [])]
        );
        
        const totalVisitors = currentVisitors[0].total_visitors || 0;
        const prevTotalVisitors = previousVisitors[0].total_visitors || 0;
        const newUsers = currentVisitors[0].new_users || 0;
        const prevNewUsers = previousVisitors[0].new_users || 0;
        
        // Calculate percentage changes
        const visitorsChange = prevTotalVisitors > 0 
            ? ((totalVisitors - prevTotalVisitors) / prevTotalVisitors) * 100 
            : 0;
            
        const newUsersChange = prevNewUsers > 0 
            ? ((newUsers - prevNewUsers) / prevNewUsers) * 100 
            : 0;
        
        // Calculate daily active users (average over the period)
        const [dailyActive] = await connection.query(
            `SELECT AVG(daily_users) as avg_daily_users
             FROM (
                SELECT DATE(s.started_at) as date, COUNT(DISTINCT u.user_id) as daily_users
                FROM sessions s
                JOIN users u ON s.user_id = u.user_id
                JOIN events e ON s.session_id = e.session_id
                WHERE s.started_at BETWEEN ? AND ?${siteFilter}
                GROUP BY DATE(s.started_at)
             ) as daily_stats`,
            params
        );
        
        return {
            totalVisitors,
            previousVisitors: prevTotalVisitors,
            visitorsChange,
            newUsers,
            newUsersChange,
            returningUsers: currentVisitors[0].returning_users || 0,
            dailyActiveUsers: Math.round(dailyActive[0].avg_daily_users || 0)
        };
    }

    /**
     * Get conversion metrics
     * @private
     */
    async _getConversionMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, siteId) {
        const siteFilter = siteId ? ' AND e.event_data->"$.siteId" = ?' : '';
        const params = siteId ? [startDate, endDate, siteId, startDate, endDate, siteId] : [startDate, endDate, startDate, endDate];
        const prevParams = siteId ? [previousStartDate, previousEndDate, siteId, previousStartDate, previousEndDate, siteId] : [previousStartDate, previousEndDate, previousStartDate, previousEndDate];
        
        // Current period conversions
        const [currentConversion] = await connection.query(
            `SELECT 
                (SELECT COUNT(DISTINCT s.session_id) 
                 FROM sessions s
                 JOIN events e ON s.session_id = e.session_id
                 WHERE s.started_at BETWEEN ? AND ?${siteFilter}) as total_sessions,
                
                (SELECT COUNT(DISTINCT e.session_id) 
                 FROM events e
                 JOIN purchases p ON e.event_id = p.event_id
                 WHERE e.event_time BETWEEN ? AND ?${siteFilter}) as converted_sessions,
                 
                (SELECT COUNT(DISTINCT e.session_id)
                 FROM events e
                 WHERE e.event_name = 'begin_checkout' 
                 AND e.event_time BETWEEN ? AND ?${siteFilter}) as checkout_sessions
            `,
            [...params, startDate, endDate, ...(siteId ? [siteId] : [])]
        );
        
        // Previous period conversions
        const [previousConversion] = await connection.query(
            `SELECT 
                (SELECT COUNT(DISTINCT s.session_id) 
                 FROM sessions s
                 JOIN events e ON s.session_id = e.session_id
                 WHERE s.started_at BETWEEN ? AND ?${siteFilter}) as total_sessions,
                
                (SELECT COUNT(DISTINCT e.session_id) 
                 FROM events e
                 JOIN purchases p ON e.event_id = p.event_id
                 WHERE e.event_time BETWEEN ? AND ?${siteFilter}) as converted_sessions
            `,
            prevParams
        );
        
        const totalSessions = currentConversion[0].total_sessions || 0;
        const convertedSessions = currentConversion[0].converted_sessions || 0;
        const checkoutSessions = currentConversion[0].checkout_sessions || 0;
        
        const prevTotalSessions = previousConversion[0].total_sessions || 0;
        const prevConvertedSessions = previousConversion[0].converted_sessions || 0;
        
        // Calculate conversion rates
        const conversionRate = totalSessions > 0 
            ? (convertedSessions / totalSessions) * 100 
            : 0;
            
        const prevConversionRate = prevTotalSessions > 0 
            ? (prevConvertedSessions / prevTotalSessions) * 100 
            : 0;
            
        const checkoutCompletionRate = checkoutSessions > 0 
            ? (convertedSessions / checkoutSessions) * 100 
            : 0;
        
        // Calculate percentage change
        const conversionChange = prevConversionRate > 0 
            ? ((conversionRate - prevConversionRate) / prevConversionRate) * 100 
            : 0;
        
        return {
            conversionRate,
            previousConversionRate: prevConversionRate,
            conversionChange,
            checkoutCompletionRate
        };
    }

    /**
     * Get cart metrics
     * @private
     */
    async _getCartMetrics(connection, startDate, endDate, previousStartDate, previousEndDate, siteId) {
        const siteFilter = siteId ? ' AND e.event_data->"$.siteId" = ?' : '';
        const params = siteId ? [startDate, endDate, siteId, startDate, endDate, siteId] : [startDate, endDate, startDate, endDate];
        const prevParams = siteId ? [previousStartDate, previousEndDate, siteId, previousStartDate, previousEndDate, siteId] : [previousStartDate, previousEndDate, previousStartDate, previousEndDate];
        
        // Current period cart metrics
        const [currentCart] = await connection.query(
            `SELECT 
                (SELECT COUNT(DISTINCT ca.cart_action_id) 
                 FROM cart_actions ca
                 JOIN events e ON ca.event_id = e.event_id
                 WHERE ca.action_type = 'add'
                 AND e.event_time BETWEEN ? AND ?${siteFilter}) as cart_adds,
                
                (SELECT COUNT(DISTINCT e.session_id) 
                 FROM events e
                 JOIN purchases p ON e.event_id = p.event_id
                 WHERE e.event_time BETWEEN ? AND ?${siteFilter}) as purchase_sessions
            `,
            params
        );
        
        // Previous period cart metrics
        const [previousCart] = await connection.query(
            `SELECT 
                (SELECT COUNT(DISTINCT ca.cart_action_id) 
                 FROM cart_actions ca
                 JOIN events e ON ca.event_id = e.event_id
                 WHERE ca.action_type = 'add'
                 AND e.event_time BETWEEN ? AND ?${siteFilter}) as cart_adds,
                
                (SELECT COUNT(DISTINCT e.session_id) 
                 FROM events e
                 JOIN purchases p ON e.event_id = p.event_id
                 WHERE e.event_time BETWEEN ? AND ?${siteFilter}) as purchase_sessions
            `,
            prevParams
        );
        
        const cartAdds = currentCart[0].cart_adds || 0;
        const purchaseSessions = currentCart[0].purchase_sessions || 0;
        
        const prevCartAdds = previousCart[0].cart_adds || 0;
        const prevPurchaseSessions = previousCart[0].purchase_sessions || 0;
        
        // Calculate abandonment rates
        const abandonmentRate = cartAdds > 0 
            ? ((cartAdds - purchaseSessions) / cartAdds) * 100 
            : 0;
            
        const prevAbandonmentRate = prevCartAdds > 0 
            ? ((prevCartAdds - prevPurchaseSessions) / prevCartAdds) * 100 
            : 0;
        
        // Calculate percentage change
        const abandonmentChange = prevAbandonmentRate > 0 
            ? ((abandonmentRate - prevAbandonmentRate) / prevAbandonmentRate) * 100 
            : 0;
        
        return {
            abandonmentRate,
            previousAbandonmentRate: prevAbandonmentRate,
            abandonmentChange
        };
    }

    /**
     * Set up Express routes for analytics endpoints
     */
    setupRoutes(app) {
        // Analytics overview endpoint
        app.get('/ui/analytics/overview', async (req, res) => {
            try {
                const period = req.query.period || '7d';
                const siteId = req.query.siteId || null;
                
                const result = await this.getAnalyticsOverview(
                    { config: { db: this.dbConfig } }, 
                    { period, siteId }
                );
                
                res.status(200).json(result);
            } catch (error) {
                console.error("API Error:", error);
                res.status(500).json({ 
                    success: false, 
                    error: "Failed to retrieve analytics overview" 
                });
            }
        });
        
        // Additional analytics endpoints can be added here
        // Revenue time series data
        app.get('/ui/analytics/revenue', async (req, res) => {
            // Implementation similar to getAnalyticsOverview but for revenue timeseries
            res.status(200).json({ message: "Revenue endpoint placeholder" });
        });
        
        // Conversion funnel data
        app.get('/ui/analytics/conversion-funnel', async (req, res) => {
            // Implementation for conversion funnel data
            res.status(200).json({ message: "Conversion funnel endpoint placeholder" });
        });
        
        // Traffic sources data
        app.get('/ui/analytics/traffic', async (req, res) => {
            // Implementation for traffic sources data
            res.status(200).json({ message: "Traffic sources endpoint placeholder" });
        });
        
        // User behavior data
        app.get('/ui/analytics/user-behavior', async (req, res) => {
            // Implementation for user behavior data
            res.status(200).json({ message: "User behavior endpoint placeholder" });
        });
        
        // Product performance data
        app.get('/ui/analytics/products', async (req, res) => {
            // Implementation for product performance data
            res.status(200).json({ message: "Product performance endpoint placeholder" });
        });
    }
}

module.exports = AnalyticsOverviewService;
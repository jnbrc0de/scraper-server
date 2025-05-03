/**
 * Email Notification Service
 * Handles sending email notifications for failures and alerts
 */
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const config = require('../../config');

class EmailService {
  constructor() {
    this.enabled = config.email.enabled;
    this.transporter = null;
    
    if (this.enabled) {
      this.initialize();
    } else {
      logger.info('Email notifications disabled');
    }
  }

  /**
   * Initialize the email transporter
   */
  initialize() {
    try {
      this.transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.secure,
        auth: {
          user: config.email.from,
          pass: process.env.EMAIL_PASS // Get from environment variable for security
        }
      });
      
      logger.info('Email service initialized', {
        host: config.email.host,
        from: config.email.from
      });
    } catch (error) {
      logger.error('Failed to initialize email service', {}, error);
      this.enabled = false;
    }
  }

  /**
   * Send an email notification
   * @param {Object} options - Email options
   * @param {string} options.subject - Email subject
   * @param {string} options.text - Email body text
   * @param {string} [options.html] - Email HTML body (optional)
   * @param {Array} [options.attachments] - File attachments
   * @returns {Promise<boolean>} - Success or failure
   */
  async sendEmail(options) {
    if (!this.enabled || !this.transporter) {
      logger.debug('Email service disabled, not sending email', { subject: options.subject });
      return false;
    }
    
    try {
      const { subject, text, html, attachments } = options;
      
      const emailOptions = {
        from: config.email.from,
        to: config.email.to,
        subject,
        text
      };
      
      if (html) {
        emailOptions.html = html;
      }
      
      if (attachments && Array.isArray(attachments)) {
        emailOptions.attachments = attachments;
      }
      
      await this.transporter.sendMail(emailOptions);
      
      logger.info('Email notification sent', { subject });
      return true;
    } catch (error) {
      logger.error('Failed to send email notification', { subject: options.subject }, error);
      return false;
    }
  }

  /**
   * Send a failure notification with screenshots and error logs
   * @param {Object} options - Failure notification options
   * @param {string} options.url - The URL that failed
   * @param {string|Array<string>} options.reason - Failure reason(s)
   * @param {string} [options.screenshotPath] - Path to screenshot file
   * @param {string} [options.logPath] - Path to log file
   * @returns {Promise<boolean>} - Success or failure
   */
  async sendFailureNotification(options) {
    if (!this.enabled) return false;
    
    const { url, reason, screenshotPath, logPath } = options;
    
    const reasons = Array.isArray(reason) ? reason : [reason];
    const attachments = [];
    
    try {
      // Add screenshot if available
      if (screenshotPath && await this._fileExists(screenshotPath)) {
        attachments.push({
          filename: path.basename(screenshotPath),
          path: screenshotPath
        });
      }
      
      // Add log file if available
      if (logPath && await this._fileExists(logPath)) {
        attachments.push({
          filename: path.basename(logPath),
          path: logPath
        });
      }
      
      return this.sendEmail({
        subject: `[Scraper FAIL] ${url}`,
        text: `Failure scraping: ${url}\n\nReasons:\n${reasons.join('\n')}`,
        attachments
      });
    } catch (error) {
      logger.error('Error preparing failure notification', { url }, error);
      return false;
    }
  }

  /**
   * Send a system alert notification
   * @param {string} subject - Alert subject
   * @param {string} message - Alert message
   * @param {Object} [data={}] - Additional alert data
   * @returns {Promise<boolean>} - Success or failure
   */
  async sendSystemAlert(subject, message, data = {}) {
    if (!this.enabled) return false;
    
    try {
      const formattedData = Object.entries(data)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join('\n');
      
      const text = `${message}\n\n${formattedData ? `Details:\n${formattedData}` : ''}`;
      
      return this.sendEmail({
        subject: `[Scraper ALERT] ${subject}`,
        text
      });
    } catch (error) {
      logger.error('Error sending system alert', { subject }, error);
      return false;
    }
  }

  /**
   * Check if file exists
   * @param {string} filePath - Path to file
   * @returns {Promise<boolean>} - True if file exists
   * @private
   */
  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = new EmailService(); 
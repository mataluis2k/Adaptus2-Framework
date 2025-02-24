/* define a globale response object to store the response from the rule engine
*/
const response = {
    status: 200,
    message: '',
    error: '',
    data: {},
    module: '',
    setResponse: function(status, message, error, data, module){
        console.log('Updating response:', { status, message, error, data, module });
        if(this.status > status){
            return; // we don't want to override a status code that is already set
        }
        this.status = status;
        if(status === 600){
            this.status = 200;
        }
        this.message = message;
        this.error = error;
        this.response = data;
        this.data = data;
        this.module = module;
        return this;
    },
    Reset: function(){
        console.log('Resetting response');
        this.status = 200;
        this.message = '';
        this.error = '';        
        this.module = '';
        this.response = "";
        return this;
    }
}

module.exports = response;


